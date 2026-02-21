import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const { data: scores, error } = await supabase
        .from('okk_order_scores')
        .select('*')
        .order('eval_date', { ascending: false })
        .limit(500);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Загружаем имена менеджеров (first_name + last_name)
    const managerIds = Array.from(new Set((scores || []).map(s => s.manager_id).filter(Boolean)));
    let managerMap: Record<number, string> = {};
    if (managerIds.length > 0) {
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        managerMap = Object.fromEntries(
            (managers || []).map(m => [
                m.id,
                [m.first_name, m.last_name].filter(Boolean).join(' ')
            ])
        );
    }

    // Загружаем читаемые названия и цвета статусов из таблицы statuses
    const statusCodes = Array.from(new Set((scores || []).map(s => s.order_status).filter(Boolean)));
    let statusMap: Record<string, { name: string; color: string | null }> = {};
    if (statusCodes.length > 0) {
        const { data: statuses } = await supabase
            .from('statuses')
            .select('code, name, color')
            .in('code', statusCodes);

        statusMap = Object.fromEntries((statuses || []).map(s => [s.code, { name: s.name, color: s.color }]));
    }

    const enriched = (scores || []).map(s => ({
        ...s,
        manager_name: s.manager_id ? (managerMap[s.manager_id] || `#${s.manager_id}`) : '—',
        status_label: s.order_status ? (statusMap[s.order_status]?.name || s.order_status) : '—',
        status_color: s.order_status ? (statusMap[s.order_status]?.color || '#E5E7EB') : '#E5E7EB',
    }));

    return NextResponse.json({ scores: enriched });
}
