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
        settings.forEach((s: any) => settingsMap.set(s.code, s.is_working));
    }

    const mergedStatuses: StatusItem[] = (statuses || []).map((s: any) => ({
        ...s,
        // PRIORITY: Check settings table first. 
        // If settingsMap has the key, use it. 
        // If not, default to false (safest default).
        is_working: settingsMap.has(s.code) ? !!settingsMap.get(s.code) : false
    }));

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
