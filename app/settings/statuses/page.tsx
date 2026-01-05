import { supabase } from '@/utils/supabase';
import StatusList, { StatusItem } from './StatusList';

export const dynamic = 'force-dynamic';

export default async function StatusesPage() {
    // 1. Get Base Statuses (Sync Data)
    const { data: statuses, error: statusError } = await supabase
        .from('statuses')
        .select('*')
        .order('ordering', { ascending: true });

    if (statusError) {
        return <div style={{ padding: 40, color: 'red' }}>Error loading statuses: {statusError.message}</div>;
    }

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
        settings.forEach((s: any) => settingsMap.set(s.code, { is_working: s.is_working, is_transcribable: s.is_transcribable }));
    }

    const mergedStatuses: StatusItem[] = (statuses || []).map((s: any) => {
        const setting = settingsMap.get(s.code) || { is_working: false, is_transcribable: false };
        return {
            ...s,
            is_working: !!setting.is_working,
            is_transcribable: !!setting.is_transcribable
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
