
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        // Default to Moscow time date if not provided (many RetailCRM users are in MSK/Russia)
        const nowInMSK = new Date(new Date().getTime() + (3 * 60 * 60 * 1000));
        const date = searchParams.get('date') || nowInMSK.toISOString().split('T')[0];

        // 1. Fetch "Key for Today" orders directly from RetailCRM for real-time data
        // Filter: [customFields][control]=1 AND [customFields][data_kontakta]=date
        const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
        const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
        const baseUrl = RETAILCRM_URL?.replace(/\/+$/, '');

        const crmUrl = `${baseUrl}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=100&filter[customFields][control]=1&filter[customFields][data_kontakta][min]=${date}&filter[customFields][data_kontakta][max]=${date}`;

        const crmRes = await fetch(crmUrl);
        const crmData = await crmRes.json();

        if (!crmData.success) {
            throw new Error(`RetailCRM API Error: ${crmData.errorMsg || 'Unknown error'}`);
        }

        const orders = crmData.orders || [];
        const orderIds = orders.map((o: any) => o.id);

        if (orders.length === 0) {
            return NextResponse.json({ success: true, orders: [] });
        }

        // 2. Get unique manager IDs and fetch their names from DB
        const managerIds = Array.from(new Set(orders.map((o: any) => o.managerId).filter(Boolean)));
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        const managerMap = new Map(
            (managers || []).map(m => [
                String(m.id),
                `${m.last_name} ${m.first_name}`
            ])
        );

        // 3. Aggregate statistics from Supabase for these specific orders
        const { data: calls } = await supabase
            .from('call_order_matches')
            .select('retailcrm_order_id, telphin_call_id, raw_telphin_calls(*)')
            .in('retailcrm_order_id', orderIds);

        const { data: events } = await supabase
            .from('raw_order_events')
            .select('retailcrm_order_id, event_type, occurred_at')
            .in('retailcrm_order_id', orderIds)
            .eq('event_type', 'mail_send');

        // 4. Process each order
        const processedOrders = orders.map((order: any) => {
            // Filter calls ONLY for target date
            const orderCalls = (calls || [])
                .filter(c => c.retailcrm_order_id === order.id)
                .map((c: any) => Array.isArray(c.raw_telphin_calls) ? c.raw_telphin_calls[0] : c.raw_telphin_calls)
                .filter((c: any) => c && String(c.started_at).startsWith(date));

            // Filter emails ONLY for target date
            const orderEmails = (events || [])
                .filter(e => e.retailcrm_order_id === order.id && String(e.occurred_at).startsWith(date));

            const hasDialogue = orderCalls.some((c: any) =>
                c && c.duration_sec > 15 && c.transcript
            );

            const callCount = orderCalls.length;
            const hasEmail = orderEmails.length > 0;

            // Determine Status
            let status: 'success' | 'in_progress' | 'fallback_required' | 'overdue' = 'in_progress';

            if (hasDialogue) {
                status = 'success';
            } else if (callCount >= 3) {
                status = hasEmail ? 'success' : 'fallback_required';
            }

            // Check deadline 14:00 (of "today")
            const now = new Date();
            const deadline = new Date(date + 'T14:00:00');
            if (status !== 'success' && now > deadline) {
                status = 'overdue';
            }

            return {
                id: order.id,
                number: order.number,
                totalSumm: order.totalSumm,
                managerId: order.managerId,
                managerName: managerMap.get(String(order.managerId)) || null,
                today_stats: {
                    call_count: callCount,
                    has_dialogue: hasDialogue,
                    has_email: hasEmail,
                    status,
                    calls: orderCalls.slice(0, 3)
                },
                raw_payload: order
            };
        });

        // 5. Fetch only CONTROLLED managers for the dashboard list
        const { data: controlledSettings } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        const controlledIds = (controlledSettings || []).map(s => s.id);

        const { data: activeManagers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', controlledIds);

        // 6. Fetch "is_working" statuses for the filter using status_settings table
        const { data: workingSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

        const workingCodes = (workingSettings || []).map(s => s.code);

        const { data: activeStatuses } = await supabase
            .from('statuses')
            .select('code, name, group_name')
            .in('code', workingCodes)
            .order('ordering');

        return NextResponse.json({
            success: true,
            orders: processedOrders.sort((a: any, b: any) => b.totalSumm - a.totalSumm), // Sort by sum desc
            activeManagers: (activeManagers || []).map(m => ({
                id: m.id,
                name: m.last_name ? `${m.last_name} ${m.first_name}` : m.first_name
            })),
            activeStatuses: activeStatuses || []
        });

    } catch (error: any) {
        console.error('Priority API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
