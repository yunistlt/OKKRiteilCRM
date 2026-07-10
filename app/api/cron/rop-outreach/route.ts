// Крон Артёма (РОП-бот): приглашает новые заявки на квалификацию и возвращает зависшие.
// Запускается раз в 1-2 минуты (см. vercel.json). Пока rop_outreach_settings.enabled = false,
// работает в «сухом» прогоне — только логирует намерения в rop_outreach_log.
import { NextResponse } from 'next/server';
import { runOutreachBatch, runTimeoutReturns, getOutreachSettings } from '@/lib/sales-bot/outreach';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get('authorization');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        const settings = await getOutreachSettings();
        const outreach = await runOutreachBatch();
        const timeouts = await runTimeoutReturns();

        return NextResponse.json({
            ok: true,
            mode: settings.enabled ? 'live' : 'dry_run',
            outreach,
            timeouts,
        });
    } catch (error: any) {
        console.error('[rop-outreach] error:', error?.message || error);
        return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 });
    }
}
