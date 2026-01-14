import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // Default to basically "all time" (from 2024)
    const endDate = new Date();
    const startDate = new Date('2024-01-01');

    const start = searchParams.get('start') || startDate.toISOString();
    const end = searchParams.get('end') || endDate.toISOString();

    try {
        // 1. Fetch Violations from DB
        const { data: rawViolations, error } = await supabase
            .from('okk_violations')
            .select('*, orders ( status, totalsumm, number )')
            .gte('violation_time', start)
            .lte('violation_time', end)
            .order('violation_time', { ascending: false });

        if (error) throw error;

        // 2. Fetch Managers for name mapping
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name');

        const managerMap: Record<number, string> = {};
        (managers || []).forEach(m => {
            managerMap[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
            // 2. Fetch Status Dictionaries for mapping
            const { data: statusesData } = await supabase
                .from('statuses')
                .select('code, name, color');

            const statusMap = new Map(statusesData?.map(s => [s.code, s]) || []);

            // 3. Map to UI format
            const violations = (rawViolations || []).map(v => {
                const statusInfo = v.orders?.status ? statusMap.get(v.orders.status) : null;
                return {
                    ...v, // Keep all original fields if needed
                    violation_type: v.rule_code,
                    manager_id: v.manager_id,
                    manager_name: v.managers ? `${v.managers.first_name || ''} ${v.managers.last_name || ''}`.trim() : (v.manager_id === null ? 'Система' : 'Не определен'),
                    order_id: v.order_id,
                    call_id: v.call_id,
                    details: v.details,
                    severity: v.severity,
                    created_at: v.violation_time, // Map DB time to UI expected field
                    order_status: statusInfo?.name || v.orders?.status,
                    order_status_code: v.orders?.status, // Keep code for reference
                    order_status_color: statusInfo?.color || '#e5e7eb', // Default gray
                    order_sum: v.orders?.totalsumm,
                    order_number: v.orders?.number
                };
            });

            return NextResponse.json({
                range: { start, end },
                count: violations.length,
                violations
            });
        } catch (error: any) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
    }
