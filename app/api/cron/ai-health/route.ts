import { NextRequest, NextResponse } from 'next/server';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { collectAiHealth } from '@/lib/ai-health';
import { sendTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.ai_health';

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString('ru-RU');

/**
 * Ежедневная сводка по ИИ-контуру в конце рабочего дня.
 *
 * Молчит, когда всё в порядке: пишет в Telegram только если есть о чём тревожиться.
 * Полная картина всегда возвращается в ответе роута — её можно запросить руками,
 * и любое число в сводке раскладывается до исходных данных.
 *
 * Деньги на счёте здесь не проверяются: за них отвечает ежечасный ai-balance-watch.
 */
export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);

        const report = await collectAiHealth();

        let action = 'quiet';
        if (report.problems.length > 0) {
            const lines: string[] = ['⚠️ <b>ИИ-контур: есть вопросы</b>', ''];
            for (const problem of report.problems) lines.push(`• ${problem}`);

            lines.push('');
            lines.push(`За сутки: ${int(report.callsDay)} вызовов, $${money(report.spentDayUsd)} (${money(report.spentDayRub)} ₽).`);
            if (report.cacheSharePct !== null) {
                lines.push(`Из кэша отдано ${int(report.cacheHitsDay)} разборов — ${Math.round(report.cacheSharePct)}% работы без обращения к модели.`);
            }

            await sendTelegramNotification(lines.join('\n'));
            action = 'alerted';
        }

        await recordWorkerSuccess(WORKER_KEY, {
            last_call_at: report.lastCallAt,
            silence_hours: report.silenceHours,
            spent_day_usd: report.spentDayUsd,
            avg_day_usd: report.avgDayUsd,
            calls_day: report.callsDay,
            cache_hits_day: report.cacheHitsDay,
            cache_rows: report.cacheRows,
            problems: report.problems.length,
            action,
        });

        return NextResponse.json({ ok: true, action, report });
    } catch (error: any) {
        if (error.message !== 'Unauthorized') {
            await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown ai-health error');
        }
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
