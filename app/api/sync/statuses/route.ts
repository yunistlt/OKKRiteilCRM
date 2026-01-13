import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const url = `${RETAILCRM_URL}/api/v5/reference/statuses?apiKey=${RETAILCRM_KEY}`;
        const [statusesRes, groupsRes] = await Promise.all([
            fetch(url),
            fetch(`${RETAILCRM_URL}/api/v5/reference/status-groups?apiKey=${RETAILCRM_KEY}`)
        ]);

        if (!statusesRes.ok) throw new Error(`CRM Statuses Error: ${statusesRes.statusText}`);
        if (!groupsRes.ok) throw new Error(`CRM Groups Error: ${groupsRes.statusText}`);

        const statusesData = await statusesRes.json();
        const groupsData = await groupsRes.json();

        const statuses = statusesData.statuses;
        const groups = groupsData.statusGroups; // RetailCRM usually returns 'statusGroups'

        if (!statuses) {
            return NextResponse.json({ message: 'No statuses found' });
        }

        // Map group code to full group data
        const groupMap: Record<string, any> = {};
        if (groups) {
            Object.values(groups).forEach((g: any) => {
                groupMap[g.code] = g;
            });
        }

        const rows = Object.values(statuses).map((s: any) => {
            const group = groupMap[s.group];
            // Try to find color in status, then in group
            const color = s.rgb || s.color || group?.rgb || group?.color || group?.hex || null;

            return {
                code: s.code,
                name: s.name,
                ordering: s.ordering || 0,
                updated_at: new Date().toISOString(),
                group_name: group?.name || s.group || 'Other',
                is_active: s.active === true,
                color: color
            };
        });

        const inactiveCount = rows.filter((r: any) => !r.is_active).length;

        // Upsert: On conflict, basic fields update, but is_working is preserved
        const { error } = await supabase
            .from('statuses')
            .upsert(rows, { onConflict: 'code', ignoreDuplicates: false });

        if (error) throw error;

        return NextResponse.json({
            success: true,
            count: rows.length,
            inactive_count: inactiveCount,
            groups_found: Object.keys(groupMap).length,
            message: 'DEBUG 2: Checking Groups',
            debug_sample_status: Object.values(statuses)[0],
            debug_sample_group: Object.values(groups)[0], // Check if group has color
            debug_resolved_color: rows[0]?.color
        }, {
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
