/**
 * Остаток денег на счёте OpenAI и проверка «живости» ключа.
 *
 * OpenAI НЕ отдаёт остаток счёта по обычному secret-ключу (эндпоинты /v1/dashboard/billing/*
 * требуют session key из браузера), поэтому остаток считаем сами:
 *   остаток = последний снимок баланса (ai_balance_snapshots) − наши расходы (ai_usage_events) после него.
 * Снимок заносится при каждом пополнении. Порог алерта и курс USD→EUR — в ai_cost_settings.
 *
 * Независимо от расчёта делаем дешёвый ping к API: он ловит реальное «деньги кончились»
 * (429 insufficient_quota) даже если снимок устарел.
 */
import { supabase } from '@/utils/supabase';

export interface AiBalanceSettings {
    usdToEur: number;
    alertEur: number;
    muteHours: number;
}

export interface AiBalanceState {
    /** Остаток в USD; null — снимка баланса ещё нет, посчитать не от чего. */
    balanceUsd: number | null;
    balanceEur: number | null;
    spentSinceSnapshotUsd: number;
    snapshotAt: string | null;
    /** Средний расход в USD за сутки по последним 7 дням (для прогноза «хватит на N дней»). */
    burnPerDayUsd: number;
    daysLeft: number | null;
}

export async function getAiBalanceSettings(): Promise<AiBalanceSettings> {
    const { data } = await supabase
        .from('ai_cost_settings')
        .select('usd_to_eur, balance_alert_eur, balance_alert_mute_hours')
        .maybeSingle();
    return {
        usdToEur: Number(data?.usd_to_eur) || 0.92,
        alertEur: Number(data?.balance_alert_eur) || 3,
        muteHours: Number(data?.balance_alert_mute_hours) || 6,
    };
}

/** Считает остаток от последнего снимка баланса за вычетом расходов после него. */
export async function getAiBalanceState(settings: AiBalanceSettings): Promise<AiBalanceState> {
    const { data: snap } = await supabase
        .from('ai_balance_snapshots')
        .select('balance_usd, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const sinceIso = snap?.occurred_at || null;
    let spent = 0;
    if (sinceIso) {
        const { data: rows } = await supabase
            .from('ai_usage_events')
            .select('cost_usd')
            .gte('created_at', sinceIso);
        spent = (rows || []).reduce((acc: number, r: any) => acc + (Number(r.cost_usd) || 0), 0);
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: weekRows } = await supabase
        .from('ai_usage_events')
        .select('cost_usd')
        .gte('created_at', weekAgo);
    const weekSpent = (weekRows || []).reduce((acc: number, r: any) => acc + (Number(r.cost_usd) || 0), 0);
    const burnPerDayUsd = weekSpent / 7;

    const balanceUsd = snap ? Math.max(0, Number(snap.balance_usd) - spent) : null;
    return {
        balanceUsd,
        balanceEur: balanceUsd === null ? null : balanceUsd * settings.usdToEur,
        spentSinceSnapshotUsd: spent,
        snapshotAt: sinceIso,
        burnPerDayUsd,
        daysLeft: balanceUsd !== null && burnPerDayUsd > 0 ? balanceUsd / burnPerDayUsd : null,
    };
}

/** Дешёвый вызов к OpenAI: ловит реальное «деньги кончились» и мёртвый ключ. */
export async function pingOpenAi(): Promise<{ ok: boolean; quotaExhausted: boolean; status: number; message?: string }> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, quotaExhausted: false, status: 0, message: 'OPENAI_API_KEY не задан' };
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
            }),
        });
        if (res.ok) return { ok: true, quotaExhausted: false, status: res.status };
        const body = await res.text();
        const quotaExhausted = res.status === 429
            && (body.includes('insufficient_quota') || body.includes('credit_balance_exhausted'));
        return { ok: false, quotaExhausted, status: res.status, message: body.slice(0, 300) };
    } catch (e: any) {
        return { ok: false, quotaExhausted: false, status: 0, message: e?.message };
    }
}
