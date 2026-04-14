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

const STATUS_COLOR_RULES: Array<{ color: string; patterns: string[] }> = [
    { color: '#FEE2E2', patterns: ['cancel', 'otmen', 'отмен', 'reklam', 'реклам', 'refund', 'возврат', 'tender', 'тендер', 'fail', 'proval', 'провал'] },
    { color: '#DCFCE7', patterns: ['complete', 'vypoln', 'выполн', 'oplata', 'оплат', 'paid', 'оплачен'] },
    { color: '#E0E7FF', patterns: ['delivery', 'deliv', 'dostav', 'достав'] },
    { color: '#F3E8FF', patterns: ['assembling', 'sbork', 'сбор', 'komplekt', 'комплект'] },
    { color: '#FEF3C7', patterns: ['work', 'approval', 'soglas', 'соглас', 'dogovor', 'договор', 'schet', 'счет', 'ожидани', 'proschet'] },
    { color: '#DBEAFE', patterns: ['new', 'nov', 'нов', 'zayav', 'заяв', 'lead'] },
    { color: '#E0F2FE', patterns: ['base', 'база', 'razvit', 'развит', 'tehn', 'техн', 'perenos', 'перенос', 'holod', 'холод', 'proizv', 'производ'] },
    { color: '#FFE4E6', patterns: ['return', 'vozvrat', 'возврат'] }
];

function normalizeColor(value?: string | null) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed.toUpperCase();
    if (/^[0-9a-fA-F]{6}$/.test(trimmed) || /^[0-9a-fA-F]{3}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`;
    if (/^rgb(a)?\(/i.test(trimmed)) return trimmed;
    return null;
}

function inferStatusColor(...sources: Array<string | null | undefined>) {
    const haystack = sources
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(' ');

    if (!haystack) return null;

    for (const rule of STATUS_COLOR_RULES) {
        if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
            return rule.color;
        }
    }

    return null;
}

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

        const { data: existingStatuses } = await supabase
            .from('statuses')
            .select('code, color');

        const existingColorMap = new Map<string, string | null>(
            (existingStatuses || []).map((status: any) => [status.code, normalizeColor(status.color) || null])
        );

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
            // Try to find color in status, then in group, then infer from known patterns.
            let color = normalizeColor(s.rgb) || normalizeColor(s.color) || normalizeColor(group?.rgb) || normalizeColor(group?.color) || normalizeColor(group?.hex);

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

            if (!color) {
                color = inferStatusColor(s.group, group?.code, group?.name, s.code, s.name);
            }

            if (!color) {
                color = existingColorMap.get(s.code) || null;
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
