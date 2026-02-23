import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Fetch controlled managers from settings
        const { data: controlledSettings, error: err1 } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        if (err1) throw err1;

        const managerIds = (controlledSettings || []).map((s: { id: number }) => s.id);

        if (managerIds.length === 0) {
            return NextResponse.json([]);
        }

        // Fetch user info for controlled managers
        const { data: managers, error: err2 } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        if (err2) throw err2;

        const activeManagers = (managers || []).map(m => ({
            id: m.id,
            name: [m.first_name, m.last_name].filter(Boolean).join(' ') || `#${m.id}`
        })).sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json(activeManagers);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
