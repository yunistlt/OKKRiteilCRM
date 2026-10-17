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
 * ТРЕВОГА ТОЛЬКО ПО ПОЛОМКЕ. 17.10.2026 сторож разбудил владельца в выходной тем,
 * что очередь ничего не доделала за ночь: накануне воркеры перевели на рабочее время
 * (`0 5,8,11,14 * * 1-5`), а норматив остался общий — «что-то должно доделываться
 * каждые 45 минут». Теперь перед тревогой выясняется ПРИЧИНА молчания, и ответов три:
 *
 *   поломка   — исполнитель по расписанию приходил и работу не взял → тревога;
 *   расписание — исполнителю ещё рано (ночь, выходной, раз в три часа) → молчим;
 *   нечего делать — очередь пуста → молчим.
 *
 * Расписание не дублируется и не «настраивается» заново: оно читается из vercel.json,
 * единственного места, где оно настоящее (см. lib/system-job-workers.ts). Поменяли
 * крон — сторож судит уже по новому, без единой правки здесь.
 *
 * Каждое число раскладывается до исходных данных: в ответе и сама отметка времени,
 * и норматив, по которому её признали просроченной.
 */
import { supabase } from '@/utils/supabase';
import { cronRunsBetween, lastCronRunAt, tryParseCron } from '@/lib/cron-schedule';
import { describeJobType, getCronScheduleForPath } from '@/lib/system-job-workers';

/** Нормативы тишины (минуты) для того, что не привязано к очереди работ. */
const THRESHOLDS = {
    /** письмо со status='new' ждёт разбора в том же заходе крона */
    emailStuckMinutes: 120,
    /** сколько заходов крона почты разрешено пропустить, прежде чем это авария */
    emailPollMissedRuns: 3,
    /** и не меньше получаса в любом случае: деплой не должен считаться аварией */
    emailPollMinMinutes: 30,
    /**
     * Сколько раз исполнитель должен пройти мимо готовой работы, чтобы это считалось
     * поломкой. Один проход — не улика: воркер берёт работы малыми порциями и мог
     * быть занят соседними.
     */
    missedRunsBeforeAlarm: 2,
    /**
     * Проходов, после которых очередь признаётся непосильной: исполнитель работает,
     * но за столько заходов так и не добрался до самой старой работы. Это не сбой
     * программы, а нехватка пропускной способности — но владельцу знать надо.
     */
    backlogRuns: 12,
    /**
     * Тип работ без крон-воркера. Ставить такие работы некому — но если они всё же
     * появились и лежат сутки, их никто и не возьмёт: это поломка.
     */
    orphanJobHours: 24,
} as const;

export type PulseVerdict = 'ok' | 'broken' | 'waiting_schedule' | 'idle';

export type PulseCheck = {
    /** Технический код — для сравнения снаружи */
    key: string;
    /** Человеческое имя для сообщения владельцу */
    title: string;
    ok: boolean;
    /** Почему проверка в таком состоянии: поломка, ждём расписания, нечего делать */
    verdict: PulseVerdict;
    /** Разбор причины человеческим языком — виден всегда, даже когда тревоги нет */
    reason: string;
    /** Когда подсистема подавала признаки жизни в последний раз */
    lastAt: string | null;
    /** Сколько минут прошло с тех пор */
    silenceMinutes: number | null;
    /** Норматив, после которого молчание считается аварией */
    limitMinutes: number | null;
    /** Что именно сломалось — готовая строка для Telegram. Только для поломок */
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

function formatCount(value: number): string {
    return value.toLocaleString('ru-RU');
}

function formatMoment(value: string | null): string {
    if (!value) return 'неизвестно когда';
    return new Date(value).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
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

/**
 * Приём почты. Норматив считается от расписания самого крона: разрешаем пропустить
 * несколько заходов (деплой, холодный старт) и не меньше получаса.
 */
function emailPollCheck(lastAt: string | null, now: Date): PulseCheck {
    const expression = getCronScheduleForPath('/api/cron/email-poll');
    const spec = expression ? tryParseCron(expression) : null;

    // Крон почты ходит круглосуточно, поэтому интервал берём по двум соседним заходам.
    const previousRun = spec ? lastCronRunAt(spec, now) : null;
    const intervalMinutes =
        spec && previousRun
            ? Math.max(
                  1,
                  Math.round(
                      (previousRun.getTime() -
                          (lastCronRunAt(spec, new Date(previousRun.getTime() - 60_000))?.getTime() ??
                              previousRun.getTime() - 5 * 60_000)) /
                          60000,
                  ),
              )
            : 5;

    const limitMinutes = Math.max(
        THRESHOLDS.emailPollMinMinutes,
        intervalMinutes * THRESHOLDS.emailPollMissedRuns,
    );
    const silenceMinutes = minutesSince(lastAt, now);
    const broken = silenceMinutes === null || silenceMinutes > limitMinutes;

    return {
        key: 'email_poll',
        title: 'Приём почты',
        ok: !broken,
        verdict: broken ? 'broken' : 'ok',
        reason: broken
            ? `Крон почты ходит раз в ${intervalMinutes} мин, а писем не забирал ${formatAge(silenceMinutes)}`
            : `Забирал письма ${formatAge(silenceMinutes)} назад`,
        lastAt,
        silenceMinutes,
        limitMinutes,
        problem: broken
            ? `Приём почты: не забирал письма ${formatAge(silenceMinutes)} (норматив ${formatAge(limitMinutes)})`
            : null,
    };
}

function stuckEmailsCheck(oldestAt: string | null, now: Date): PulseCheck {
    const age = minutesSince(oldestAt, now);
    const broken = age !== null && age > THRESHOLDS.emailStuckMinutes;

    return {
        key: 'emails_stuck',
        title: 'Письма без разбора',
        ok: !broken,
        verdict: broken ? 'broken' : age === null ? 'idle' : 'ok',
        reason:
            age === null
                ? 'Неразобранных писем нет'
                : broken
                  ? `Самое старое письмо ждёт разбора ${formatAge(age)}`
                  : `Самое старое письмо ждёт ${formatAge(age)}, это в норме`,
        lastAt: oldestAt,
        silenceMinutes: age,
        limitMinutes: THRESHOLDS.emailStuckMinutes,
        problem: broken
            ? `Письма без разбора: самое старое ждёт ${formatAge(age)} (норматив ${formatAge(THRESHOLDS.emailStuckMinutes)})`
            : null,
    };
}

type QueueSlice = { jobType: string; oldestAvailableAt: string; waiting: number };

/**
 * Готовые к взятию работы: по каждому типу — самая старая и сколько их.
 *
 * Количество берём отдельным счётом, а не длиной выборки: PostgREST отдаёт не
 * больше тысячи строк за раз, и при хвосте в 1 159 работ сторож писал владельцу
 * «1 000» — ровно столько, сколько влезло. Число в сообщении должно раскладываться
 * до исходных данных, а не упираться в предел выдачи.
 */
async function readyQueueByType(now: Date): Promise<QueueSlice[]> {
    const readyBefore = now.toISOString();

    const { data } = await supabase
        .from('system_jobs')
        .select('job_type, available_at')
        .eq('status', 'queued')
        .lte('available_at', readyBefore)
        .order('available_at', { ascending: true })
        .limit(1000);

    // Самая старая работа каждого типа — первая встреченная: выборка отсортирована.
    const oldestByType = new Map<string, string>();
    for (const row of (data || []) as Array<{ job_type: string; available_at: string }>) {
        const jobType = String(row.job_type || '');
        if (jobType && !oldestByType.has(jobType)) oldestByType.set(jobType, row.available_at);
    }

    const slices: QueueSlice[] = [];
    for (const [jobType, oldestAvailableAt] of Array.from(oldestByType.entries())) {
        const { count } = await supabase
            .from('system_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'queued')
            .eq('job_type', jobType)
            .lte('available_at', readyBefore);

        slices.push({ jobType, oldestAvailableAt, waiting: Number(count ?? 0) });
    }

    return slices;
}

async function lastCompletedAt(jobType: string): Promise<string | null> {
    const { data } = await supabase
        .from('system_jobs')
        .select('finished_at')
        .eq('job_type', jobType)
        .eq('status', 'completed')
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

    return data?.finished_at ?? null;
}

/**
 * Разбор одного типа работ: исполнитель сломался, ещё не приходил или просто не успевает.
 */
async function inspectQueueSlice(slice: QueueSlice, now: Date): Promise<PulseCheck> {
    const { title, spec, scheduleExpression, retired } = describeJobType(slice.jobType);
    const waiting = formatCount(slice.waiting);
    const since = formatMoment(slice.oldestAvailableAt);
    const waitingMinutes = minutesSince(slice.oldestAvailableAt, now);
    const base = {
        key: `jobs:${slice.jobType}`,
        title,
        lastAt: slice.oldestAvailableAt,
        silenceMinutes: waitingMinutes,
    };

    // Тип без крон-воркера: взять эти работы некому.
    if (!spec) {
        if (retired) {
            return {
                ...base,
                ok: true,
                verdict: 'idle',
                reason: `${waiting} работ лежит наследством: тип снят с производства, новых не ставят`,
                limitMinutes: null,
                problem: null,
            };
        }

        const brokenByAge = (waitingMinutes ?? 0) > THRESHOLDS.orphanJobHours * 60;
        return {
            ...base,
            ok: !brokenByAge,
            verdict: brokenByAge ? 'broken' : 'waiting_schedule',
            reason: scheduleExpression
                ? `Расписание «${scheduleExpression}» не удалось разобрать`
                : 'У этого типа работ нет крон-воркера',
            limitMinutes: THRESHOLDS.orphanJobHours * 60,
            problem: brokenByAge
                ? `${title}: ${waiting} работ ждут с ${since}, исполнителя по расписанию нет`
                : null,
        };
    }

    const runsSinceReady = cronRunsBetween(spec, new Date(slice.oldestAvailableAt), now);

    // Исполнителю ещё рано: ночь, выходной или просто не настал час по расписанию.
    if (runsSinceReady < THRESHOLDS.missedRunsBeforeAlarm) {
        const nextRunHint = scheduleExpression ? ` (расписание «${scheduleExpression}»)` : '';
        return {
            ...base,
            ok: true,
            verdict: 'waiting_schedule',
            reason: `${waiting} работ ждут с ${since}; исполнитель по расписанию приходил ${runsSinceReady} раз${nextRunHint}`,
            limitMinutes: null,
            problem: null,
        };
    }

    const lastDone = await lastCompletedAt(slice.jobType);
    const progressAfterReady = lastDone !== null && new Date(lastDone) > new Date(slice.oldestAvailableAt);

    // Приходил, но не доделал ни одной работы с тех пор, как появилась эта — сломан.
    if (!progressAfterReady) {
        return {
            ...base,
            ok: false,
            verdict: 'broken',
            reason: `Исполнитель приходил ${runsSinceReady} раз по расписанию «${scheduleExpression}» и не доделал ни одной работы`,
            limitMinutes: null,
            problem: `${title}: ${waiting} работ ждут с ${since}, исполнитель приходил ${runsSinceReady} раз и не взял ни одной (последняя выполненная — ${formatMoment(lastDone)})`,
        };
    }

    // Работает, но не успевает разгрести хвост.
    if (runsSinceReady >= THRESHOLDS.backlogRuns) {
        return {
            ...base,
            ok: false,
            verdict: 'broken',
            reason: `Исполнитель работает, но за ${runsSinceReady} заходов не дошёл до работ от ${since}`,
            limitMinutes: null,
            problem: `${title}: ${waiting} работ ждут с ${since} — исполнитель работает, но за ${runsSinceReady} заходов очередь не разгрёб`,
        };
    }

    return {
        ...base,
        ok: true,
        verdict: 'ok',
        reason: `${waiting} работ в очереди, исполнитель разбирает (последняя выполненная — ${formatMoment(lastDone)})`,
        limitMinutes: null,
        problem: null,
    };
}

/**
 * Снимок живости конвейера. Ничего не чинит и не запускает — только смотрит.
 */
export async function collectPipelinePulse(): Promise<PipelinePulse> {
    const now = new Date();

    const [emailPoll, stuckEmail, queue] = await Promise.all([
        lastEmailPoll(),
        oldestUnclassifiedEmail(),
        readyQueueByType(now),
    ]);

    const checks: PulseCheck[] = [emailPollCheck(emailPoll, now), stuckEmailsCheck(stuckEmail, now)];

    if (!queue.length) {
        checks.push({
            key: 'jobs_queue',
            title: 'Очередь работ',
            ok: true,
            verdict: 'idle',
            reason: 'Готовых к взятию работ нет — проверять нечего',
            lastAt: null,
            silenceMinutes: null,
            limitMinutes: null,
            problem: null,
        });
    } else {
        for (const slice of queue) {
            checks.push(await inspectQueueSlice(slice, now));
        }
    }

    /**
     * Проверки «Очередь работ ничего не доделала за N минут» здесь больше нет.
     *
     * Она звала на помощь всякий раз, когда делать было нечего или исполнителю было
     * рано: пустая очередь — не авария, а тишина. Живость очереди теперь меряется
     * по каждому типу работ отдельно и только против его собственного расписания.
     *
     * Проверки «Заказы из RetailCRM» нет с 05.10.2026: приём выключен решением
     * владельца, и сторож будил владельца тем, что мы отключили сами.
     */

    const problems = checks.map((check) => check.problem).filter((problem): problem is string => Boolean(problem));

    return {
        ok: problems.length === 0,
        checkedAt: now.toISOString(),
        problems,
        checks,
    };
}
