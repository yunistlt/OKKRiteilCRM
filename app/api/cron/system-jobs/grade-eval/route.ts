import { NextRequest, NextResponse } from 'next/server';
import { isSystemJobsPipelineRuntimeEnabled } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { recomputeGrades } from '@/lib/salary/grades';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.grade_eval';

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

/** Прошлый календарный месяц относительно сегодня (он уже полностью отработан). */
function lastCompletedMonth(): { year: number; month: number } {
    const now = new Date();
    const idx = now.getFullYear() * 12 + now.getMonth() - 1; // getMonth() 0-based = прошлый месяц в 1-based
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * Пересчёт грейдов по итогам месяца M; грейд вступает в силу с M+1.
 * M = последний ЗАКРЫТЫЙ период, но не старше прошлого календарного месяца:
 * без закрытий (а их может не быть месяцами) механика иначе молчит вечно, а
 * «приз месяца» обязан приходить сам. Закрытые периоды при этом не мутируются —
 * пишется только леджер грейдов на M+1. Идемпотентно (upsert по manager_id+дате).
 */
export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);
        if (!(await isSystemJobsPipelineRuntimeEnabled())) {
            return NextResponse.json({ ok: true, status: 'disabled' });
        }

        const { data: closed } = await supabase
            .from('salary_period')
            .select('year,month')
            .eq('status', 'closed')
            .order('year', { ascending: false })
            .order('month', { ascending: false })
            .limit(1);
        const lastClosed = (closed as any[])?.[0];
        const calendar = lastCompletedMonth();
        const closedIdx = lastClosed ? Number(lastClosed.year) * 12 + Number(lastClosed.month) : -1;
        const useClosed = closedIdx >= calendar.year * 12 + calendar.month;
        const through = useClosed ? { year: Number(lastClosed.year), month: Number(lastClosed.month) } : calendar;
        const basis = useClosed ? 'closed_period' : 'last_calendar_month';

        const result = await recomputeGrades(through.year, through.month, 'cron:grade-eval');
        const changed = result.rows.filter((r) => r.change !== 0).length;
        await recordWorkerSuccess(WORKER_KEY, { throughMonth: result.effectiveFrom, basis, mode: result.mode, changed, managers: result.rows.length });
        return NextResponse.json({ ok: true, status: 'processed', basis, mode: result.mode, through: `${through.year}-${through.month}`, effectiveFrom: result.effectiveFrom, changed, managers: result.rows.length });
    } catch (error: any) {
        if (error.message !== 'Unauthorized') {
            await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown grade-eval route error');
        }
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
