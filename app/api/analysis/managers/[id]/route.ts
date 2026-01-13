import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { detectViolations } from '@/lib/violations';
import { calculateEfficiency } from '@/lib/efficiency';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const managerId = parseInt(params.id);
    if (isNaN(managerId)) {
        return NextResponse.json({ error: 'Invalid manager ID' }, { status: 400 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        // 1. Fetch Manager Info
        const { data: manager, error: managerError } = await supabase
            .from('managers')
            .select('*')
            .eq('id', managerId)
            .single();

        if (managerError || !manager) {
            console.log(`[ManagerAPI] Manager ${managerId} not found in DB`);
            return NextResponse.json({ error: 'Manager not found' }, { status: 404 });
        }

        // 2. Define Date Range
        let endDate = to ? `${to}T23:59:59Z` : new Date().toISOString();
        let startStr = from ? `${from}T00:00:00Z` : '';

        if (!startStr) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            startStr = startDate.toISOString();
        }

        // 3. Fetch Calls for this manager
        // 3. Fetch Calls for this manager
        const { data: calls } = await supabase
            .from('raw_telphin_calls')
            .select(`
                id: telphin_call_id,
                timestamp: started_at,
                duration: duration_sec,
                record_url: recording_url,
                raw_payload,
                call_order_matches!inner (
                    orders!inner (
                        manager_id,
                        order_id,
                        number,
                        status,
                        totalsumm,
                        order_priorities (
                            level
                        )
                    )
                )
            `)
            .eq('call_order_matches.orders.manager_id', managerId)
            .gte('started_at', startStr)
            .order('started_at', { ascending: false });

        // Transform raw_payload to expected fields
        const formattedCalls = calls?.map(c => ({
            ...c,
            transcript: (c.raw_payload as any)?.transcript,
            is_answering_machine: (c.raw_payload as any)?.is_answering_machine,
            // Map priority to the order in matches for easier frontend access
            call_order_matches: c.call_order_matches?.map((m: any) => ({
                ...m,
                orders: {
                    ...m.orders,
                    priority: (Array.isArray(m.orders?.order_priorities)
                        ? m.orders?.order_priorities?.[0]?.level
                        : m.orders?.order_priorities?.level) || 'black'
                }
            }))
        }));

        // 4. Fetch Violations (using the library, then filtering)
        const allViolations = await detectViolations(startStr, endDate);
        const managerViolations = allViolations.filter(v => v.manager_id === managerId);

        // 5. Fetch Statuses for reference
        const { data: statusesData } = await supabase
            .from('statuses')
            .select('code, name');

        const statusMap: Record<string, string> = {};
        statusesData?.forEach((s: any) => {
            statusMap[s.code] = s.name;
        });

        // Enrich calls with status names
        const enrichedCalls = formattedCalls?.map(c => ({
            ...c,
            call_order_matches: c.call_order_matches?.map((m: any) => ({
                ...m,
                orders: {
                    ...m.orders,
                    status_name: statusMap[m.orders.status] || m.orders.status
                }
            }))
        }));

        // 6. Calculate Efficiency (Work Time)
        // Pass correctly formatted date strings
        const efficiencyData = await calculateEfficiency(startStr.split('T')[0], endDate.split('T')[0]);
        const managerEfficiency = efficiencyData.find(m => m.manager_id === managerId);

        // Heuristic for efficiency percent: 
        // 8 hours/day * 22 days = ~10560 mins per month.
        const workTimeMins = managerEfficiency?.total_minutes || 0;
        const efficiencyPercent = Math.min(100, Math.round((workTimeMins / 10560) * 100));

        return NextResponse.json({
            manager,
            stats: {
                total_calls: enrichedCalls?.length || 0,
                total_violations: managerViolations.length,
                efficiency_percent: efficiencyPercent,
                work_time_minutes: workTimeMins
            },
            violations: managerViolations.slice(0, 50),
            calls: enrichedCalls || [], // Full history for the audit period (30 days)
        });

    } catch (e: any) {
        console.error('[ManagerAPI Error]', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
