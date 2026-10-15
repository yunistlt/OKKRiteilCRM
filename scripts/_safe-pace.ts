/**
 * Безопасный темп для разовых докачек из RetailCRM.
 *
 * Повод — инцидент 15.10.2026: шесть потоков лили историю заказов пачками по
 * 500 строк, база (Supabase MICRO, t4g.micro) захлебнулась и перестала
 * отвечать на 15 минут. Отдел в это время работал. Правило владельца после
 * разбора: качаем по ночам и безопасными партиями.
 *
 * Что модуль даёт любой докачке:
 *  1. Окно работы. По умолчанию ночное: днём прогон не идёт, а начатый
 *     засыпает с приходом утра. Можно задать окно датами — тогда внутри него
 *     работа идёт круглосуточно, а по его окончании прогон встаёт сам. Так
 *     владелец назначил тестовую докачку с пятницы 20:00 до понедельника 6:00.
 *  2. Пачки по 100 строк с паузой: база успевает между ними дышать.
 *  3. Сторож темпа — если запись стала медленной, пауза растёт; если совсем
 *     плохо, прогон останавливается сам, не дожидаясь падения базы.
 *  4. Сторож диска — на MICRO диск заполнен на 82%, и уход в read-only
 *     страшнее медленной докачки.
 */
import type { Sql } from 'postgres';

/** Ночное окно по Москве: с 21:00 до 7:00. */
const NIGHT_FROM_HOUR = 21;
const NIGHT_TO_HOUR = 7;

/** Пачка строк за один INSERT. */
export const BATCH_SIZE = 100;

/** Пауза между пачками в спокойном режиме. */
const BASE_PAUSE_MS = 150;

/** Вставка дольше этого — база напряглась, замедляемся. */
const SLOW_INSERT_MS = 3000;

/** Вставка дольше этого — останавливаем прогон. */
const CRITICAL_INSERT_MS = 15000;

/** Останавливаемся, если база выросла до этого размера. */
const DISK_LIMIT_MB = Number(process.env.BACKFILL_DISK_LIMIT_MB || 6000);

/**
 * Окно работы датами, по Москве: BACKFILL_WINDOW_FROM / BACKFILL_WINDOW_TO
 * в виде «2026-10-16 20:00». Задано — работаем внутри него круглосуточно,
 * не задано — держимся ночного окна.
 */
function parseMoscow(value: string | undefined): Date | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    // Москва = UTC+3 круглый год, перевода часов нет.
    const date = new Date(raw.replace(' ', 'T') + (/[+\-]\d\d:?\d\d$|Z$/.test(raw) ? '' : '+03:00'));
    return Number.isNaN(date.getTime()) ? null : date;
}

export const WINDOW_FROM = parseMoscow(process.env.BACKFILL_WINDOW_FROM);
export const WINDOW_TO = parseMoscow(process.env.BACKFILL_WINDOW_TO);

export function moscowTime(at = new Date()): string {
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at) + ' МСК';
}

export function moscowHour(at = new Date()): number {
    return Number(new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
    }).format(at));
}

export function isNight(at = new Date()): boolean {
    const h = moscowHour(at);
    return h >= NIGHT_FROM_HOUR || h < NIGHT_TO_HOUR;
}

/** Окно кончилось — больше работать нельзя, прогон встаёт насовсем. */
export function windowClosed(at = new Date()): boolean {
    return Boolean(WINDOW_TO && at.getTime() >= WINDOW_TO.getTime());
}

/** Можно ли работать прямо сейчас. */
export function canWorkNow(at = new Date()): boolean {
    if (WINDOW_FROM || WINDOW_TO) {
        if (WINDOW_FROM && at.getTime() < WINDOW_FROM.getTime()) return false;
        if (WINDOW_TO && at.getTime() >= WINDOW_TO.getTime()) return false;
        return true;
    }
    return isNight(at);
}

export function describeWindow(): string {
    if (WINDOW_FROM || WINDOW_TO) {
        const from = WINDOW_FROM ? moscowTime(WINDOW_FROM) : 'сейчас';
        const to = WINDOW_TO ? moscowTime(WINDOW_TO) : 'без конца';
        return `окно ${from} — ${to}, круглосуточно`;
    }
    return `ночное окно ${NIGHT_FROM_HOUR}:00 — ${NIGHT_TO_HOUR}:00 МСК`;
}

/**
 * Ждёт, когда можно работать. Возвращает false, если ждать больше нечего —
 * заданное окно закрылось.
 */
export async function waitForWindow(log: (s: string) => void = console.log): Promise<boolean> {
    let announced = false;
    while (!canWorkNow()) {
        if (windowClosed()) {
            log(`Окно докачки закрылось (${describeWindow()}). Прогон завершён.`);
            return false;
        }
        if (!announced) {
            log(`Сейчас ${moscowTime()} — не время работы. Ждём: ${describeWindow()}. Прогон продолжится сам.`);
            announced = true;
        }
        await sleep(60_000);
    }
    return true;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Сколько мегабайт занимает база сейчас. */
export async function databaseSizeMb(sql: Sql<any>): Promise<number> {
    const [row] = await sql`SELECT pg_database_size(current_database()) AS bytes`;
    return Math.round(Number(row.bytes) / 1024 / 1024);
}

export class PaceGuard {
    private pause = BASE_PAUSE_MS;
    private slowStreak = 0;
    stopped: string | null = null;

    constructor(private sql: Sql<any>, private log: (s: string) => void = console.log) {}

    /** Проверки перед очередной пачкой: окно, диск, темп. */
    async beforeBatch(): Promise<boolean> {
        if (this.stopped) return false;

        if (!(await waitForWindow(this.log))) {
            this.stopped = 'окно докачки закрылось';
            return false;
        }

        const mb = await databaseSizeMb(this.sql);
        if (mb >= DISK_LIMIT_MB) {
            this.stopped = `база выросла до ${mb} МБ при пороге ${DISK_LIMIT_MB} МБ`;
            this.log(`СТОП: ${this.stopped}. Докачка прервана, чтобы база не ушла в режим только для чтения.`);
            return false;
        }

        await sleep(this.pause);
        return true;
    }

    /** Замер одной вставки: решает, ускоряться, тормозить или встать. */
    afterBatch(elapsedMs: number): void {
        if (elapsedMs >= CRITICAL_INSERT_MS) {
            this.stopped = `вставка заняла ${(elapsedMs / 1000).toFixed(1)} с`;
            this.log(`СТОП: ${this.stopped}. База не справляется, прогон остановлен.`);
            return;
        }

        if (elapsedMs >= SLOW_INSERT_MS) {
            this.slowStreak++;
            this.pause = Math.min(this.pause * 2, 10_000);
            this.log(`База отвечает медленно (${(elapsedMs / 1000).toFixed(1)} с), пауза между пачками ${this.pause} мс.`);
            if (this.slowStreak >= 10) {
                this.stopped = 'десять медленных пачек подряд';
                this.log(`СТОП: ${this.stopped}.`);
            }
            return;
        }

        this.slowStreak = 0;
        if (this.pause > BASE_PAUSE_MS) this.pause = Math.max(BASE_PAUSE_MS, Math.floor(this.pause / 2));
    }
}
