// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { formatEventValue, COMMUNICATION_FIELD_PATTERNS } from '@/lib/order-events';
import { buildFieldLabelResolver } from '@/lib/order-field-labels';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    try {
        // 1. Fetch Order Details (Basic info)
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
                *,
                managers ( first_name, last_name, email )
            `)
            .eq('order_id', id)
            .single();

        if (orderError) throw orderError;

        // 2. Fetch Call Transcriptions (via raw_telphin_calls and matches)
        // We join call_order_matches -> raw_telphin_calls -> call_transcriptions
        // Since Supabase joins can be tricky with multiple levels, we'll do it in steps or use a View if it existed.
        // Step A: Get matched call IDs
        const { data: matches } = await supabase
            .from('call_order_matches')
            .select('telphin_call_id, confidence_score, match_type')
            .eq('retailcrm_order_id', id)
            .order('matched_at', { ascending: false });

        const callIds = matches?.map(m => m.telphin_call_id) || [];

        let calls: any[] = [];
        if (callIds.length > 0) {
            // Step B: Fetch calls and their transcriptions
            const { data: callsData, error: callsError } = await supabase
                .from('raw_telphin_calls')
                .select('*')
                .in('telphin_call_id', callIds)
                .order('started_at', { ascending: false });

            if (callsError) console.error('[Details] Error fetching calls:', callsError);

            calls = callsData || [];
        }

        // 3. Коммуникации (письма, сообщения, комментарии) — из истории заказа
        //    (order_history_log; raw_order_events заморожена, см. lib/order-events.ts)
        const { data: events } = await supabase
            .from('order_history_log')
            .select('field, old_value, new_value, occurred_at')
            .eq('retailcrm_order_id', order.order_id)
            .or(COMMUNICATION_FIELD_PATTERNS.map((p) => `field.ilike.${p}`).join(','))
            .order('occurred_at', { ascending: false })
            .limit(10);

        // Normalize events for frontend
        const emails = events?.map(e => ({
            id: e.occurred_at, // use timestamp as id
            date: e.occurred_at,
            type: e.field,
            text: formatEventValue(e.new_value),
            source: 'retailcrm'
        })) || [];

        // 4. История изменений заказа — канонический order_history_log
        const { data: rawHistory } = await supabase
            .from('order_history_log')
            .select('field, old_value, new_value, occurred_at, user_data')
            .eq('retailcrm_order_id', order.order_id)
            .order('occurred_at', { ascending: false });

        // Автора изменения CRM отдаёт как {id}; имя подставляем из справочника
        // менеджеров, иначе в интерфейсе будет голый код (закон: только
        // человеческий язык).
        const historyUserIds = Array.from(
            new Set(((rawHistory as any[]) ?? [])
                .map((h) => h.user_data?.id)
                .filter((id: any) => id != null)
                .map(Number)),
        );
        const userNames = new Map<number, { firstName: string; lastName: string }>();
        if (historyUserIds.length) {
            const { data: mgrs } = await supabase
                .from('managers')
                .select('id, first_name, last_name')
                .in('id', historyUserIds);
            for (const m of (mgrs as any[]) ?? []) {
                userNames.set(Number(m.id), { firstName: m.first_name || '', lastName: m.last_name || '' });
            }
        }

        const fieldLabel = await buildFieldLabelResolver();

        const history = ((rawHistory as any[]) ?? []).map((h) => ({
            field: h.field,
            field_label: fieldLabel(h.field),
            old_value: formatEventValue(h.old_value),
            new_value: formatEventValue(h.new_value),
            user_data: h.user_data?.id != null
                ? userNames.get(Number(h.user_data.id)) ?? { firstName: 'RetailCRM', lastName: '' }
                : { firstName: 'Система', lastName: '' },
            occurred_at: h.occurred_at,
        }));

        // 5. Fetch AI Priority Analysis
        const { data: priority } = await supabase
            .from('order_priorities')
            .select('*')
            .eq('order_id', order.id) // This is the internal UUID (orders.id), check if table uses internal id
            .maybeSingle();

        // 6. Fetch Anna's Insights
        const { data: metrics } = await supabase
            .from('order_metrics')
            .select('insights')
            .eq('retailcrm_order_id', order.order_id)
            .maybeSingle();

        // Return structured data
        return NextResponse.json({
            order: {
                ...order,
                manager_name: order.managers ? `${order.managers.first_name || ''} ${order.managers.last_name || ''}`.trim() : 'Не определен'
            },
            priority: priority, // Return priority data
            insights: metrics?.insights || null,
            calls: calls.map(c => ({
                id: c.telphin_call_id,
                date: c.started_at,
                type: c.direction,
                duration: c.duration_sec,
                transcription: c.transcript || c.call_transcriptions?.[0]?.transcription_text || null,
                summary: c.summary || c.call_transcriptions?.[0]?.summary || null,
                link: c.recording_url
            })),
            emails: emails,
            history: history || [],
            raw_payload: order.raw_payload
        });

    } catch (e: any) {
        console.error('Order Details Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
