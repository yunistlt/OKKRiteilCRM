// @ts-nocheck
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
        const endDateObj = new Date();
        const endDate = endDateObj.toISOString();
        endDateObj.setDate(endDateObj.getDate() - 30);
        const startStr = endDateObj.toISOString();

        // 3. Звонки этого менеджера за период.
        //
        // Раньше звонки брались встроенным джойном call_order_matches — то есть
        // нашим матчингом по номеру телефона, который ошибается примерно в
        // трети случаев. Здесь по ним оценивают работу человека, поэтому связь
        // идёт через call_order_link: привязка из RetailCRM основная, матчинг
        // запасной. Форма ответа оставлена прежней — страница читает её как
        // раньше, и переписывать разметку ради смены источника незачем.
        const { data: managerOrders } = await supabase
            .from('orders')
            .select('id, order_id, number, status, totalsumm, manager_id')
            .eq('manager_id', managerId);

        const orderById = new Map(((managerOrders ?? []) as any[]).map((o) => [Number(o.id), o]));
        const orderIds = Array.from(orderById.keys());

        const links: any[] = [];
        for (let i = 0; i < orderIds.length; i += 300) {
            const { data } = await supabase
                .from('call_order_link')
                .select('order_id, telphin_call_id, started_at')
                .in('order_id', orderIds.slice(i, i + 300))
                .gte('started_at', startStr)
                .lte('started_at', endDate);
            links.push(...((data ?? []) as any[]));
        }

        // Приоритет заказа — отдельной выборкой, он показывается цветом.
        const linkedOrderIds = Array.from(new Set(links.map((l) => Number(l.order_id))));
        const priorityByOrder = new Map<number, string>();
        for (let i = 0; i < linkedOrderIds.length; i += 300) {
            const { data } = await supabase
                .from('order_priorities')
                .select('order_id, level')
                .in('order_id', linkedOrderIds.slice(i, i + 300));
            for (const p of ((data ?? []) as any[])) priorityByOrder.set(Number(p.order_id), String(p.level));
        }

        const callIds = Array.from(new Set(links.map((l) => String(l.telphin_call_id))));
        const rawById = new Map<string, any>();
        for (let i = 0; i < callIds.length; i += 300) {
            const { data } = await supabase
                .from('raw_telphin_calls')
                .select('telphin_call_id, started_at, duration_sec, recording_url, raw_payload, transcript')
                .in('telphin_call_id', callIds.slice(i, i + 300));
            for (const c of ((data ?? []) as any[])) rawById.set(String(c.telphin_call_id), c);
        }

        const formattedCalls = links
            .map((l) => {
                const raw = rawById.get(String(l.telphin_call_id));
                const order = orderById.get(Number(l.order_id));
                if (!raw || !order) return null;
                return {
                    id: String(l.telphin_call_id),
                    timestamp: raw.started_at ?? l.started_at,
                    duration: raw.duration_sec ?? 0,
                    record_url: raw.recording_url ?? null,
                    raw_payload: raw.raw_payload ?? null,
                    transcript: raw.transcript ?? (raw.raw_payload as any)?.transcript,
                    is_answering_machine: (raw.raw_payload as any)?.is_answering_machine,
                    call_order_matches: [
                        {
                            orders: {
                                manager_id: order.manager_id,
                                order_id: order.order_id,
                                number: order.number,
                                status: order.status,
                                totalsumm: order.totalsumm,
                                priority: priorityByOrder.get(Number(l.order_id)) || 'black',
                            },
                        },
                    ],
                };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => String(b.timestamp).localeCompare(String(a.timestamp)));

        // 4. Fetch Violations (using the library, then filtering)
        const allViolations = await detectViolations(startStr, endDate);
        const managerViolations = allViolations.filter(v => v.manager_id === managerId);

        // 5. Fetch Statuses for reference
        const { data: statusesData } = await supabase
            .from('statuses')
            .select('code, name, color');

        const statusMap: Record<string, { name: string, color?: string }> = {};
        statusesData?.forEach((s: any) => {
            statusMap[s.code] = { name: s.name, color: s.color };
        });

        // Enrich calls with status names & colors
        const enrichedCalls = formattedCalls?.map(c => ({
            ...c,
            call_order_matches: c.call_order_matches?.map((m: any) => ({
                ...m,
                orders: {
                    ...m.orders,
                    status_name: statusMap[m.orders.status]?.name || m.orders.status,
                    status_color: statusMap[m.orders.status]?.color
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
