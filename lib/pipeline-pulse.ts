/**
 * Пульс конвейера — «жив ли автомат» одним запросом.
 *
 * Зачем. 25.09.2026 крон-роуты закрыли проверкой ключа, ключ на проде не завели —
 * и планировщик Vercel три дня получал 401. Встало ВСЁ: приём почты, очередь работ,
 * синхронизация заказов. Никто не заметил: заявки просто перестали появляться, а
 * сторожа, которые могли бы крикнуть, сами были кронами и умерли вместе со всеми.
 *
 * Отсюда правило: этот модуль только СЧИТАЕТ состояние и ничего не запускает, а
 * будильник живёт снаружи (крон на VPS, см. ops/watchdog/README.md). Внешний сторож
 * переживает смерть кронов Vercel — внутренний не переживает по определению.
 *
 * Каждое число раскладывается до исходных данных: в ответе и сама отметка времени,
 * и норматив, по которому её признали просроченной.
 */
import { supabase } from '@/utils/supabase';

/**
 * Нормативы тишины (минуты). Считаны от расписания в vercel.json с запасом:
 * крон раз в 5 минут может пропустить пару заходов на деплое, это не авария.
 */
const THRESHOLDS = {
    /** email-poll ходит раз в 5 минут */
    emailPollMinutes: 45,
    /** письмо со status='new' ждёт разбора в том же заходе крона */
    emailStuckMinutes: 120,
    /** воркеры очереди работают круглосуточно, раз в 1–2 минуты */
    jobsFinishedMinutes: 45,
    /** работа в очереди не должна ждать исполнителя часами */
    jobsQueuedMinutes: 120,
    /**
     * За сколько тип работ обязан доделать хоть что-то, прежде чем считать его мёртвым.
     * Сутки с запасом: ночные типы (сверка, оценки) ходят раз в день, и более короткий
     * норматив объявлял бы их вставшими каждый день после обеда.
     */
    jobTypeDeadHours: 26,
    /** синхронизация заказов из RetailCRM идёт круглосуточно */
} as const;

export type PulseCheck = {
    /** Технический код — для сравнения снаружи */
    key: string;
    /** Человеческое имя для сообщения владельцу */
    title: string;
    ok: boolean;
    /** Когда подсистема подавала признаки жизни в последний раз */
    lastAt: string | null;
    /** Сколько минут прошло с тех пор */
    silenceMinutes: number | null;
    /** Норматив, после которого молчание считается аварией */
    limitMinutes: number;
    /** Что именно не так — готовая строка для Telegram */
    problem: string | null;
};

export type PipelinePulse = {
    ok: boolean;
    checkedAt: string;
    problems: string[];
    checks: PulseCheck[];
};

function minutesSince(value: string | Date | null | undefined, now: Date): number | null {
    if (!value) return null;
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return null;
    return Math.round((now.getTime() - at.getTime()) / 60000);
}

function formatAge(minutes: number | null): string {
    if (minutes === null) return 'никогда';
    if (minutes < 90) return `${minutes} мин`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} ч`;
    return `${Math.round(hours / 24)} сут`;
}

/** Молчание дольше норматива — авария. Пустая отметка тоже авария: значит не работало никогда. */
function silenceCheck(params: {
    key: string;
    title: string;
    lastAt: string | null;
    limitMinutes: number;
    now: Date;
    /** Как описать просрочку владельцу: «<title> молчит N» */
    verb?: string;
}): PulseCheck {
    const silenceMinutes = minutesSince(params.lastAt, params.now);
    const ok = silenceMinutes !== null && silenceMinutes <= params.limitMinutes;

    return {
        key: params.key,
        title: params.title,
        ok,
        lastAt: params.lastAt,
        silenceMinutes,
        limitMinutes: params.limitMinutes,
        problem: ok
            ? null
            : `${params.title}: ${params.verb || 'молчит'} ${formatAge(silenceMinutes)} (норматив ${formatAge(params.limitMinutes)})`,
    };
}

async function lastEmailPoll(): Promise<string | null> {
    const { data } = await supabase
        .from('email_ingest_state')
        .select('last_run_at')
        .order('last_run_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data?.last_run_at ?? null;
}

async function oldestUnclassifiedEmail(): Promise<string | null> {
    const { data } = await supabase
        .from('incoming_emails')
        .select('created_at')
        .eq('status', 'new')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    return data?.created_at ?? null;
}

async function lastFinishedJob(): Promise<string | null> {
    const { data } = await supabase
        .from('system_jobs')
        .select('finished_at')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    return data?.finished_at ?? null;
}

/**
 * Встал ли какой-то ТИП работ.
 *
 * Считать по самой старой работе в очереди нельзя: в очереди всегда лежит хвост,
 * который воркер пропускает (приоритет, ключ конкуренции), — по нему тревога горела бы
 * вечно. 28.09.2026 такой хвост от 25-го был у четырёх типов, хотя воркеры в ту же
 * минуту доделывали свежие работы.
 *
 * Тип считается вставшим, когда сошлись два признака: работа ждёт дольше норматива
 * И этот же тип давно ничего не доделал. Один признак без другого — не авария.
 */
async function stalledJobTypes(now: Date): Promise<string[]> {
    const queuedCutoff = new Date(now.getTime() - THRESHOLDS.jobsQueuedMinutes * 60000).toISOString();

    const { data: waiting } = await supabase
        .from('system_jobs')
        .select('job_type')
        .eq('status', 'queued')
        .lt('queued_at', queuedCutoff)
        .limit(2000);

    const types: string[] = Array.from(
        new Set((waiting || []).map((row: any) => String(row.job_type || '')).filter(Boolean)),
    );
    if (!types.length) return [];

    const silenceCutoff = new Date(now.getTime() - THRESHOLDS.jobTypeDeadHours * 3600000).toISOString();
    const stalled: string[] = [];

    for (const type of types) {
        const { data: lastDone } = await supabase
            .from('system_jobs')
            .select('finished_at')
            .eq('job_type', type)
            .eq('status', 'completed')
            .gte('finished_at', silenceCutoff)
            .limit(1)
            .maybeSingle();

        if (!lastDone?.finished_at) stalled.push(type);
    }

    return stalled;
}

/**
 * Снимок живости конвейера. Ничего не чинит и не запускает — только смотрит.
 */
export async function collectPipelinePulse(): Promise<PipelinePulse> {
    const now = new Date();

    const [emailPoll, stuckEmail, jobFinished, stalledTypes] = await Promise.all([
        lastEmailPoll(),
        oldestUnclassifiedEmail(),
        lastFinishedJob(),
        stalledJobTypes(now),
    ]);

    const checks: PulseCheck[] = [
        silenceCheck({
            key: 'email_poll',
            title: 'Приём почты',
            lastAt: emailPoll,
            limitMinutes: THRESHOLDS.emailPollMinutes,
            now,
            verb: 'не забирал письма',
        }),
        silenceCheck({
            key: 'jobs_finished',
            title: 'Очередь работ',
            lastAt: jobFinished,
            limitMinutes: THRESHOLDS.jobsFinishedMinutes,
            now,
            verb: 'ничего не доделала за',
        }),
    ];

    /**
     * Проверки «Заказы из RetailCRM» здесь больше нет.
     *
     * Она следила за тем, что приём изменений из RetailCRM жив. Приём выключен
     * решением владельца 05.10.2026 («никаких изменений по заказам в ритейле
     * уже не должно быть, все правки в ОКК»), и сторож начал будить владельца
     * каждые пятнадцать минут тем, что мы отключили сами.
     *
     * Заказы теперь живут у нас: за их движением следят оценки ОКК и план дня,
     * а молчание ночью — не авария, а ночь.
     */

    // Затор: письма и работы, которые лежат дольше норматива, — признак того, что
    // крон ходит, но конвейер внутри стоит (ИИ отвалился, ключ протух и т.п.).
    const stuckEmailAge = minutesSince(stuckEmail, now);
    checks.push({
        key: 'emails_stuck',
        title: 'Письма без разбора',
        ok: stuckEmailAge === null || stuckEmailAge <= THRESHOLDS.emailStuckMinutes,
        lastAt: stuckEmail,
        silenceMinutes: stuckEmailAge,
        limitMinutes: THRESHOLDS.emailStuckMinutes,
        problem:
            stuckEmailAge !== null && stuckEmailAge > THRESHOLDS.emailStuckMinutes
                ? `Письма без разбора: самое старое ждёт ${formatAge(stuckEmailAge)} (норматив ${formatAge(THRESHOLDS.emailStuckMinutes)})`
                : null,
    });

    checks.push({
        key: 'jobs_stalled',
        title: 'Работы в очереди',
        ok: stalledTypes.length === 0,
        lastAt: null,
        silenceMinutes: null,
        limitMinutes: THRESHOLDS.jobsQueuedMinutes,
        problem: stalledTypes.length
            ? `Работы в очереди: ${stalledTypes.join(', ')} — работа ждёт дольше ${formatAge(THRESHOLDS.jobsQueuedMinutes)}, а исполнитель не доделал ни одной за ${THRESHOLDS.jobTypeDeadHours} ч`
            : null,
    });

    const problems = checks.map((check) => check.problem).filter((problem): problem is string => Boolean(problem));

    return {
        ok: problems.length === 0,
        checkedAt: now.toISOString(),
        problems,
        checks,
    };
}
