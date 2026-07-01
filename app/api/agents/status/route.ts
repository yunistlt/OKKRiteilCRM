import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const STALE_AGENT_MINUTES = 10;

// Честная привязка агента к типам задач в очереди system_jobs.
// По ним считаем реальный backlog (queued/processing) — вместо выдуманного «% загрузки».
// Агенты без записи здесь (Игорь — на чистой логике, Катерина — работает по IMAP, а не через
// system_jobs, юр-агенты в foundation) намеренно не имеют метрики backlog: возвращаем null.
const AGENT_JOB_TYPES: Record<string, string[]> = {
    semen: [
        'retailcrm_order_delta_pull',
        'retailcrm_history_delta_pull',
        'retailcrm_order_upsert',
        'retailcrm_order_context_refresh',
        'telphin_call_upsert',
        'call_match',
        'call_transcription',
    ],
    anna: ['order_insight_refresh'],
    maxim: ['order_score_refresh', 'call_semantic_rules', 'manager_aggregate_refresh'],
    lev: ['legal_contract_analyze'],
    boris: ['legal_contract_scan'],
};

function getEffectiveStatus(status: string | null, lastActiveAt: string | null) {
    if (!lastActiveAt) {
        return status || 'idle';
    }

    const lastActiveMs = new Date(lastActiveAt).getTime();
    if (Number.isNaN(lastActiveMs)) {
        return status || 'idle';
    }

    const ageMinutes = (Date.now() - lastActiveMs) / 60000;
    if (status === 'working' && ageMinutes > STALE_AGENT_MINUTES) {
        return 'idle';
    }

    return status || 'idle';
}

// Считаем реальный backlog очереди по типам задач одним проходом.
// Возвращаем карту job_type -> { queued, processing }.
async function loadJobBacklog(): Promise<Record<string, { queued: number; processing: number }>> {
    const allTypes = Array.from(new Set(Object.values(AGENT_JOB_TYPES).flat()));
    const result: Record<string, { queued: number; processing: number }> = {};
    try {
        const { data, error } = await supabase
            .from('system_jobs')
            .select('job_type, status')
            .in('job_type', allTypes)
            .in('status', ['queued', 'processing']);

        if (error) throw error;

        for (const row of (data || []) as Array<{ job_type: string; status: string }>) {
            const bucket = result[row.job_type] || { queued: 0, processing: 0 };
            if (row.status === 'queued') bucket.queued += 1;
            else if (row.status === 'processing') bucket.processing += 1;
            result[row.job_type] = bucket;
        }
    } catch (e) {
        // Очередь может быть ещё не готова (миграция) — деградируем без метрики.
        console.warn('[agents/status] backlog unavailable:', (e as any)?.message);
    }
    return result;
}

function agentBacklog(
    agentId: string,
    byType: Record<string, { queued: number; processing: number }>,
): { queued: number; processing: number } | null {
    const types = AGENT_JOB_TYPES[agentId];
    if (!types) return null;
    let queued = 0;
    let processing = 0;
    for (const t of types) {
        const b = byType[t];
        if (b) {
            queued += b.queued;
            processing += b.processing;
        }
    }
    return { queued, processing };
}

export async function GET() {
    try {
        const [statusRes, backlogByType] = await Promise.all([
            supabase.from('okk_agent_status').select('*').order('agent_id'),
            loadJobBacklog(),
        ]);

        if (statusRes.error) throw statusRes.error;

        const now = Date.now();
        const agents = (statusRes.data || []).map((agent: any) => {
            const lastActiveAt = agent.last_active_at || null;
            const lastActiveMs = lastActiveAt ? new Date(lastActiveAt).getTime() : NaN;
            const ageMinutes = Number.isNaN(lastActiveMs) ? null : Math.floor((now - lastActiveMs) / 60000);
            const effectiveStatus = getEffectiveStatus(agent.status || null, lastActiveAt);
            const stale = Boolean(
                agent.status === 'working' &&
                typeof ageMinutes === 'number' &&
                ageMinutes > STALE_AGENT_MINUTES
            );

            return {
                ...agent,
                status: effectiveStatus,
                stale,
                last_active_minutes_ago: ageMinutes,
                backlog: agentBacklog(agent.agent_id, backlogByType),
            };
        });

        return NextResponse.json({
            success: true,
            stale_after_minutes: STALE_AGENT_MINUTES,
            agents,
        });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
