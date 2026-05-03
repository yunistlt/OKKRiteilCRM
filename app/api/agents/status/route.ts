import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const STALE_AGENT_MINUTES = 10;

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

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('okk_agent_status')
            .select('*')
            .order('agent_id');

        if (error) throw error;

        const now = Date.now();
        const agents = (data || []).map((agent: any) => {
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
