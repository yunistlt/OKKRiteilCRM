import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
    try {
        // 1. Fetch cached stats
        const { data: stats, error: sError } = await supabase
            .from('dialogue_stats')
            .select('*')
            .order('updated_at', { ascending: false });

        if (sError) throw sError;

        // 2. Fetch all managers for mapping
        const { data: managers, error: mError } = await supabase
            .from('managers')
            .select('id, first_name, last_name');

        if (mError) throw mError;

        const managerMap = Object.fromEntries(
            (managers || []).map(m => [m.id.toString(), `${m.first_name} ${m.last_name}`])
        );

        // 3. Map to UI format
        const formatted = (stats || []).map(s => ({
            id: s.manager_id,
            name: managerMap[s.manager_id] || `Manager ${s.manager_id}`,
            updated_at: s.updated_at,
            d1: { count: s.d1_count, duration: s.d1_duration },
            d7: { count: s.d7_count, duration: s.d7_duration },
            d30: { count: s.d30_count, duration: s.d30_duration }
        }));

        return NextResponse.json({
            data: formatted,
            lastUpdated: stats?.[0]?.updated_at || null
        });

    } catch (e: any) {
        console.error('[Quality API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
