import { supabase } from '@/utils/supabase';
import StatusList, { StatusItem } from './StatusList';

export const dynamic = 'force-dynamic';

export default async function StatusesPage() {
    // 1. Справочник статусов — один на весь проект: crm_statuses.
    //    Этап берём из crm_status_groups: по нему статусы сгруппированы на экране.
    const [{ data: statusRows, error: statusError }, { data: stageRows }] = await Promise.all([
        supabase
            .from('crm_statuses')
            .select('code, name, ordering, color, active, is_working, norm_days, ai_description, group_id')
            .order('ordering', { ascending: true }),
        supabase.from('crm_status_groups').select('id, name, ordering'),
    ]);

    if (statusError) {
        return <div style={{ padding: 40, color: 'red' }}>Error loading statuses: {statusError.message}</div>;
    }

    const stageById = new Map<string, { name: string; ordering: number }>(
        ((stageRows ?? []) as any[]).map((g) => [String(g.id), { name: String(g.name ?? ''), ordering: Number(g.ordering ?? 999) }]),
    );
    const statuses = ((statusRows ?? []) as any[])
        .map((row) => ({
            ...row,
            group_name: row.group_id ? stageById.get(String(row.group_id))?.name ?? 'Без группы' : 'Без группы',
            is_active: row.active,
            stage_ordering: row.group_id ? stageById.get(String(row.group_id))?.ordering ?? 999 : 999,
        }))
        .sort((a, b) => a.stage_ordering - b.stage_ordering || a.ordering - b.ordering);

    // 2. Get User Settings
    const { data: settings, error: settingsError } = await supabase
        .from('status_settings')
        .select('*');

    if (settingsError) {
        console.error('Settings load error:', settingsError);
        // Don't block UI, just assume no settings yet
    }

    // 3. Merge Strategies
    const settingsMap = new Map();
    if (settings) {
        settings.forEach((s: any) => settingsMap.set(s.code, {
            is_working: s.is_working,
            is_transcribable: s.is_transcribable,
            is_ai_target: s.is_ai_target,
            is_manager_load: s.is_manager_load
        }));
    }

    const mergedStatuses: StatusItem[] = (statuses || []).map((s: any) => {
        const setting = settingsMap.get(s.code) || { is_working: false, is_transcribable: false, is_ai_target: false, is_manager_load: false };
        return {
            ...s,
            is_working: !!setting.is_working,
            is_transcribable: !!setting.is_transcribable,
            is_ai_target: !!setting.is_ai_target,
            is_manager_load: !!setting.is_manager_load
        };
    });

    // 4. Fetch Order Counts
    const { data: allOrders } = await supabase.from('orders').select('status');
    const counts: Record<string, number> = {};
    (allOrders || []).forEach((o: any) => {
        if (o.status) {
            counts[o.status] = (counts[o.status] || 0) + 1;
        }
    });

    return <StatusList initialStatuses={mergedStatuses} counts={counts} />;
}
