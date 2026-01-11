
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        // --- 1. PARSE FILTERS ---
        const statuses = searchParams.get('statuses')?.split(',').filter(Boolean) || [];
        const control = searchParams.get('control') || 'all'; // 'yes', 'no', 'all'
        const sumMin = searchParams.get('sumMin');
        const sumMax = searchParams.get('sumMax');
        const dateFrom = searchParams.get('from');
        const dateTo = searchParams.get('to');

        // Check if we have "meaningful" filters to actually search for orders
        const hasFilters =
            statuses.length > 0 ||
            (control !== 'all' && control !== '') ||
            (!!sumMin || !!sumMax) ||
            (!!dateFrom || !!dateTo);

        // --- 2. FETCH AUXILIARY DATA (Managers & Statuses) ---
        // We need this for the UI dropdowns/stats regardless of order search results.

        // A. Fetch CONTROLLED managers (for "Total Key" stats list)
        // Join manager_settings -> managers
        const { data: controlledSettings } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        const controlledIds = (controlledSettings || []).map(s => s.id);

        const { data: managersData } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', controlledIds);

        const activeManagers = (managersData || []).map(m => ({
            id: m.id,
            name: m.last_name ? `${m.last_name} ${m.first_name}` : m.first_name
        }));

        // B. Fetch WORKING statuses (for Filter Dropdown)
        // Join status_settings -> statuses
        const { data: workingSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

        const workingCodes = (workingSettings || []).map(s => s.code);

        const { data: statusesData } = await supabase
            .from('statuses')
            .select('code, name, group_name')
            .in('code', workingCodes)
            .order('ordering');

        const activeStatuses = statusesData || [];

        // --- 3. EARLY EXIT: NO FILTERS ---
        if (!hasFilters) {
            return NextResponse.json({
                success: true,
                orders: [],
                activeManagers,
                activeStatuses
            });
        }

        // --- 4. CONSTRUCT RETAILCRM QUERY ---
        const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
        const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
        const baseUrl = RETAILCRM_URL?.replace(/\/+$/, '');

        let crmUrl = `${baseUrl}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=100`;

        // Status Filter
        statuses.forEach(status => {
            crmUrl += `&filter[status][]=${status}`;
        });

        // Control Filter
        if (control === 'yes') {
            crmUrl += `&filter[customFields][control]=1`;
        } else if (control === 'no') {
            crmUrl += `&filter[customFields][control]=0`;
        }

        // Date Filter (Next Contact Date)
        // Ensure we don't pass 'undefined' string
        if (dateFrom && dateFrom !== 'undefined' && dateFrom !== 'null') {
            crmUrl += `&filter[customFields][data_kontakta][min]=${dateFrom}`;
        }
        if (dateTo && dateTo !== 'undefined' && dateTo !== 'null') {
            crmUrl += `&filter[customFields][data_kontakta][max]=${dateTo}`;
        }

        // Sum Filter
        if (sumMin) crmUrl += `&filter[totalSummMin]=${sumMin}`;
        if (sumMax) crmUrl += `&filter[totalSummMax]=${sumMax}`;

        // --- 5. EXECUTE SEARCH ---
        console.log('[PriorityAPI] Fetching URL:', crmUrl);

        const crmRes = await fetch(crmUrl);
        const crmData = await crmRes.json();

        if (!crmData.success) {
            console.error('[PriorityAPI] RetailCRM Error:', JSON.stringify(crmData));
            const debugInfo = JSON.stringify({
                statuses,
                control,
                sumMin,
                sumMax,
                dateFrom,
                dateTo
            });
            throw new Error(`retailCRM Error: ${JSON.stringify(crmData.errors || crmData.errorMsg)} | Params: ${debugInfo}`);
        }

        const orders = crmData.orders || [];

        if (orders.length === 0) {
            return NextResponse.json({
                success: true,
                orders: [],
                activeManagers,
                activeStatuses
            });
        }

        // --- 6. AGGREGATE STATS FOR FOUND ORDERS ---
        const orderIds = orders.map((o: any) => o.id);

        // Fetch manager names for ALL orders (even uncontrolled ones)
        const managerIds = Array.from(new Set(orders.map((o: any) => o.managerId).filter(Boolean)));
        const { data: managersForNames } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        const managerMap = new Map(
            (managersForNames || []).map(m => [
                String(m.id),
                `${m.last_name} ${m.first_name}`
            ])
        );

        // Fetch Calls
        const { data: calls } = await supabase
            .from('call_order_matches')
            .select('retailcrm_order_id, telphin_call_id, raw_telphin_calls(*)')
            .in('retailcrm_order_id', orderIds);

        // Fetch Events (Emails)
        const { data: events } = await supabase
            .from('raw_order_events')
            .select('retailcrm_order_id, event_type, occurred_at')
            .in('retailcrm_order_id', orderIds)
            .eq('event_type', 'mail_send');

        // --- 7. PROCESS ORDERS ---
        const todayDate = new Date().toISOString().split('T')[0];

        const processedOrders = orders.map((order: any) => {
            // Stats for TODAY regarding this order
            const orderCalls = (calls || [])
                .filter(c => c.retailcrm_order_id === order.id)
                .map((c: any) => Array.isArray(c.raw_telphin_calls) ? c.raw_telphin_calls[0] : c.raw_telphin_calls)
                .filter((c: any) => c && String(c.started_at).startsWith(todayDate));

            const orderEmails = (events || [])
                .filter(e => e.retailcrm_order_id === order.id && String(e.occurred_at).startsWith(todayDate));

            const hasDialogue = orderCalls.some((c: any) =>
                c && c.duration_sec > 15 && c.transcript
            );

            const callCount = orderCalls.length;
            const hasEmail = orderEmails.length > 0;

            // Determine Dashboard Status
            let status: 'success' | 'in_progress' | 'fallback_required' | 'overdue' = 'in_progress';

            if (hasDialogue) {
                status = 'success';
            } else if (callCount >= 3) {
                status = hasEmail ? 'success' : 'fallback_required';
            }

            // Check deadline
            const now = new Date();
            const nextContactDate = order.customFields?.data_kontakta; // YYYY-MM-DD

            if (status !== 'success' && nextContactDate) {
                const deadline = new Date(nextContactDate + 'T14:00:00');
                if (now > deadline) {
                    status = 'overdue';
                }
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

        return NextResponse.json({
            success: true,
            orders: processedOrders.sort((a: any, b: any) => b.totalSumm - a.totalSumm),
            activeManagers,
            activeStatuses
        });

    } catch (error: any) {
        console.error('Priority API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
