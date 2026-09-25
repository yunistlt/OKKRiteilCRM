/**
 * Ежедневная проверка здоровья ИИ-контура.
 *
 * Деньги на счёте сторожит отдельный ежечасный /api/cron/ai-balance-watch — здесь
 * его работа не повторяется. Эта проверка смотрит на то, чего он не видит:
 *   — молчат ли агенты (вызовов нет, а рабочий день идёт);
 *   — не встали ли очереди разбора и много ли задач ушло в «мёртвые»;
 *   — сколько потрачено за сутки и не скачок ли это против недельной средней;
 *   — сколько разборов отдал кэш вместо модели (ai_result_cache).
 *
 * Пороги живут в ai_cost_settings, а не в коде.
 */
import { supabase } from '@/utils/supabase';
import { getUsdToRub } from '@/lib/ai-usage';

/** Типы задач очереди, за которыми стоит ИИ-разбор. */
const AI_JOB_TYPES = [
    'order_insight_refresh',
    'order_score_refresh',
    'call_semantic_rules',
    'call_transcription',
] as const;

export interface AiHealthThresholds {
    silenceHours: number;
    queueStuck: number;
    deadLetterAlert: number;
    spikePct: number;
}

export interface AiHealthQueue {
    jobType: string;
    queued: number;
    deadLetterDay: number;
    lastCompletedAt: string | null;
}

export interface AiHealthReport {
    /** Когда модель звали в последний раз; null — не звали никогда. */
    lastCallAt: string | null;
    silenceHours: number | null;
    spentDayUsd: number;
    spentDayRub: number;
    avgDayUsd: number;
    spikePct: number | null;
    callsDay: number;
    /** Записей кэша, пригодившихся за сутки: столько разборов не ушло в модель. */
    cacheHitsDay: number;
    cacheRows: number;
    /** Доля разборов, отданных кэшем вместо модели, в процентах. */
    cacheSharePct: number | null;
    queues: AiHealthQueue[];
    problems: string[];
    thresholds: AiHealthThresholds;
}

export async function getAiHealthThresholds(): Promise<AiHealthThresholds> {
    const { data } = await supabase
        .from('ai_cost_settings')
        .select('health_silence_hours, health_queue_stuck, health_dead_letter_alert, health_spike_pct')
        .maybeSingle();

    return {
        silenceHours: Number(data?.health_silence_hours) || 6,
        queueStuck: Number(data?.health_queue_stuck) || 300,
        deadLetterAlert: Number(data?.health_dead_letter_alert) || 20,
        spikePct: Number(data?.health_spike_pct) || 60,
    };
}

/**
 * Свод расходов считает БД, а не приложение: REST-клиент отдаёт максимум 1000 строк,
 * а вызовов в сутки тысячи — суммирование на стороне кода молча занижало бы расход.
 */
async function sumUsage(sinceIso: string): Promise<{ usd: number; calls: number }> {
    const { data, error } = await supabase.rpc('ai_usage_summary', { since: sinceIso });

    if (error) throw new Error(`Не удалось посчитать расход с ${sinceIso}: ${error.message}`);

    const row = Array.isArray(data) ? data[0] : data;
    return {
        usd: Number(row?.usd) || 0,
        calls: Number(row?.calls) || 0,
    };
}

async function collectQueues(dayAgoIso: string): Promise<AiHealthQueue[]> {
    const queues: AiHealthQueue[] = [];

    for (const jobType of AI_JOB_TYPES) {
        const { count: queued } = await supabase
            .from('system_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('job_type', jobType)
            .eq('status', 'queued');

        const { count: deadLetterDay } = await supabase
            .from('system_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('job_type', jobType)
            .eq('status', 'dead_letter')
            .gte('updated_at', dayAgoIso);

        const { data: lastCompleted } = await supabase
            .from('system_jobs')
            .select('finished_at')
            .eq('job_type', jobType)
            .eq('status', 'completed')
            .order('finished_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        queues.push({
            jobType,
            queued: queued || 0,
            deadLetterDay: deadLetterDay || 0,
            lastCompletedAt: lastCompleted?.finished_at || null,
        });
    }

    return queues;
}

/** Собирает картину за последние сутки и список того, что требует внимания. */
export async function collectAiHealth(): Promise<AiHealthReport> {
    const thresholds = await getAiHealthThresholds();
    const now = Date.now();
    const dayAgoIso = new Date(now - 24 * 3600 * 1000).toISOString();
    const weekAgoIso = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

    const { data: lastEvent } = await supabase
        .from('ai_usage_events')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const lastCallAt = lastEvent?.created_at || null;
    const silenceHours = lastCallAt
        ? (now - new Date(lastCallAt).getTime()) / 3600 / 1000
        : null;

    const day = await sumUsage(dayAgoIso);

    // Среднюю за неделю считаем только по дням, когда ИИ реально звали. Сутки простоя
    // (кончились деньги, встал пайплайн) — это не «дёшево», а «не работало»; включив их,
    // мы занизили бы норму и потом ловили бы ложный «скачок расхода».
    const { data: dailyRows, error: dailyError } = await supabase.rpc('ai_usage_daily', { since: weekAgoIso });
    if (dailyError) throw new Error(`Не удалось получить расход по дням: ${dailyError.message}`);

    const workingDays = (dailyRows || []).filter((row: any) => Number(row.calls) > 0);
    const avgDayUsd = workingDays.length
        ? workingDays.reduce((acc: number, row: any) => acc + (Number(row.usd) || 0), 0) / workingDays.length
        : 0;
    const spikePct = avgDayUsd > 0 ? ((day.usd - avgDayUsd) / avgDayUsd) * 100 : null;

    // Считаем записи, которые пригодились за сутки: каждая — это разбор, не ушедший
    // в модель. Накопленный hits за всё время для суточной картины не годится.
    const { count: cacheUsedDay } = await supabase
        .from('ai_result_cache')
        .select('cache_key', { count: 'exact', head: true })
        .gte('last_hit_at', dayAgoIso);

    const { count: cacheRows } = await supabase
        .from('ai_result_cache')
        .select('cache_key', { count: 'exact', head: true });

    const cacheHitsDay = cacheUsedDay || 0;
    const totalWork = day.calls + cacheHitsDay;
    const cacheSharePct = totalWork > 0 ? (cacheHitsDay / totalWork) * 100 : null;

    const queues = await collectQueues(dayAgoIso);

    const problems: string[] = [];

    if (silenceHours === null) {
        problems.push('Вызовов моделей не было ни разу — учёт расходов не работает.');
    } else if (silenceHours > thresholds.silenceHours) {
        problems.push(
            `Агенты молчат ${Math.floor(silenceHours)} ч подряд (порог ${thresholds.silenceHours} ч). Разбор заказов и звонков стоит.`,
        );
    }

    for (const queue of queues) {
        if (queue.queued > thresholds.queueStuck) {
            problems.push(`Очередь «${queue.jobType}»: ${queue.queued.toLocaleString('ru-RU')} задач ждут разбора.`);
        }
        if (queue.deadLetterDay > thresholds.deadLetterAlert) {
            problems.push(`Очередь «${queue.jobType}»: ${queue.deadLetterDay.toLocaleString('ru-RU')} задач за сутки ушли в «мёртвые».`);
        }
    }

    if (spikePct !== null && spikePct > thresholds.spikePct) {
        problems.push(
            `Расход за сутки $${day.usd.toFixed(2)} — на ${Math.round(spikePct)}% выше средней за неделю ($${avgDayUsd.toFixed(2)}).`,
        );
    }

    const usdToRub = await getUsdToRub();

    return {
        lastCallAt,
        silenceHours,
        spentDayUsd: day.usd,
        spentDayRub: day.usd * usdToRub,
        avgDayUsd,
        spikePct,
        callsDay: day.calls,
        cacheHitsDay,
        cacheRows: cacheRows || 0,
        cacheSharePct,
        queues,
        problems,
        thresholds,
    };
}
