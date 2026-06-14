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

/**
 * Пересчёт грейдов по ПОСЛЕДНЕМУ ЗАКРЫТОМУ месяцу. Грейд из месяцев до M
 * включительно вступает в силу с M+1 — закрытые периоды не мутируются.
 * Идемпотентно (повторный прогон того же месяца переписывает те же строки).
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
        const last = (closed as any[])?.[0];
        if (!last) {
            return NextResponse.json({ ok: true, status: 'idle', reason: 'no_closed_period' });
        }

        const result = await recomputeGrades(Number(last.year), Number(last.month), 'cron:grade-eval');
        const changed = result.rows.filter((r) => r.change !== 0).length;
        await recordWorkerSuccess(WORKER_KEY, { throughMonth: result.effectiveFrom, changed, managers: result.rows.length });
        return NextResponse.json({ ok: true, status: 'processed', through: `${last.year}-${last.month}`, effectiveFrom: result.effectiveFrom, changed, managers: result.rows.length });
    } catch (error: any) {
        if (error.message !== 'Unauthorized') {
            await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown grade-eval route error');
        }
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
