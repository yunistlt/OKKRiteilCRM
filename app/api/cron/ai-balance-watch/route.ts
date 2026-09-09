import { NextRequest, NextResponse } from 'next/server';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { getAiBalanceSettings, getAiBalanceState, pingOpenAi } from '@/lib/ai-balance';
import { sendTelegramNotification } from '@/lib/telegram';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'system_jobs.ai_balance_watch';
const ALERT_KEY = 'ai_balance_alerted_at';

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

async function getLastAlertAt(): Promise<Date | null> {
    const { data } = await supabase.from('sync_state').select('value').eq('key', ALERT_KEY).maybeSingle();
    const v = data?.value;
    return v ? new Date(v) : null;
}

async function setLastAlertAt(value: string) {
    await supabase.from('sync_state').upsert(
        { key: ALERT_KEY, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
    );
}

const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Сторожит деньги на счёте OpenAI: алертит в Telegram, когда остаток ниже порога
// или когда OpenAI уже отвечает «credit_balance_exhausted» (тогда встают все ИИ-агенты:
// письма перестают классифицироваться и заявки не создаются).
// Анти-спам: повторный алерт не чаще, чем раз в balance_alert_mute_hours.
export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);

        const settings = await getAiBalanceSettings();
        const state = await getAiBalanceState(settings);
        const ping = await pingOpenAi();

        const belowThreshold = state.balanceEur !== null && state.balanceEur < settings.alertEur;
        const shouldAlert = ping.quotaExhausted || belowThreshold;

        const lastAlertAt = await getLastAlertAt();
        const muted = lastAlertAt
            ? Date.now() - lastAlertAt.getTime() < settings.muteHours * 3600 * 1000
            : false;

        let action = 'none';
        if (shouldAlert && !muted) {
            const lines: string[] = [];
            if (ping.quotaExhausted) {
                lines.push('🛑 <b>Деньги на OpenAI кончились</b> — ИИ не работает.');
                lines.push('Письма не классифицируются, новые заявки не создаются, чат-виджет и оценки ОКК стоят.');
            } else {
                lines.push('⚠️ <b>Заканчиваются деньги на OpenAI</b>.');
            }
            if (state.balanceEur !== null && state.balanceUsd !== null) {
                lines.push(`Остаток: ~€${money(state.balanceEur)} ($${money(state.balanceUsd)}), порог €${money(settings.alertEur)}.`);
            } else {
                lines.push('Остаток посчитать не от чего: не занесён снимок баланса при пополнении.');
            }
            if (state.daysLeft !== null && !ping.quotaExhausted) {
                lines.push(`Расход ~$${money(state.burnPerDayUsd)}/день — хватит примерно на ${Math.floor(state.daysLeft)} дн.`);
            }
            lines.push('Пополнить: https://platform.openai.com/settings/organization/billing');

            await sendTelegramNotification(lines.join('\n'));
            await setLastAlertAt(new Date().toISOString());
            action = ping.quotaExhausted ? 'alerted_exhausted' : 'alerted_low';
        } else if (!shouldAlert && lastAlertAt) {
            await sendTelegramNotification(
                `✅ Баланс OpenAI пополнен: ~€${state.balanceEur !== null ? money(state.balanceEur) : '—'}. ИИ снова работает.`,
            );
            await setLastAlertAt('');
            action = 'recovered';
        }

        await recordWorkerSuccess(WORKER_KEY, {
            balance_usd: state.balanceUsd,
            balance_eur: state.balanceEur,
            spent_since_snapshot: state.spentSinceSnapshotUsd,
            burn_per_day_usd: state.burnPerDayUsd,
            ping_ok: ping.ok,
            quota_exhausted: ping.quotaExhausted,
            action,
        });

        return NextResponse.json({
            ok: true,
            balanceUsd: state.balanceUsd,
            balanceEur: state.balanceEur,
            thresholdEur: settings.alertEur,
            quotaExhausted: ping.quotaExhausted,
            action,
        });
    } catch (error: any) {
        if (error.message !== 'Unauthorized') {
            await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown ai-balance-watch error');
        }
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
