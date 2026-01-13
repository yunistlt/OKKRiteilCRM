import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY;

const STATUS_GROUP_COLORS: Record<string, string> = {
    'new': '#DBEAFE', // blue-100
    'work': '#FEF3C7', // amber-100
    'approval': '#FEF3C7', // amber-100
    'assembling': '#F3E8FF', // purple-100
    'delivery': '#E0E7FF', // indigo-100
    'complete': '#DCFCE7', // green-100
    'cancel': '#FEE2E2', // red-100
    'fail': '#FEE2E2', // red-100
    'return': '#FFE4E6' // rose-100
};

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
            const groupCode = s.group;
            // Try to find color in status, then in group, then in static map
            let color = s.rgb || s.color || group?.rgb || group?.color || group?.hex || null;

            if (!color && groupCode) {
                // Try simple match
                if (STATUS_GROUP_COLORS[groupCode]) {
                    color = STATUS_GROUP_COLORS[groupCode];
                } else {
                    // Try partial match keys
                    if (groupCode.includes('cancel') || groupCode.includes('otmen')) color = STATUS_GROUP_COLORS['cancel'];
                    else if (groupCode.includes('complete') || groupCode.includes('vypoln')) color = STATUS_GROUP_COLORS['complete'];
                    else if (groupCode.includes('deliv') || groupCode.includes('dostav')) color = STATUS_GROUP_COLORS['delivery'];
                    else if (groupCode.includes('new') || groupCode.includes('nov')) color = STATUS_GROUP_COLORS['new'];
                }
            }

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
            message: 'FIXED: Static Fallbacks applied',
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
