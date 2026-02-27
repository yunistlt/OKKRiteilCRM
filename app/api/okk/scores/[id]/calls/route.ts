import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { findOrderCandidatesByPhone } from '@/lib/call-matching';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const orderId = parseInt(params.id);

    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid Order ID' }, { status: 400 });
    }

    try {
        // 1. Fetch exactly matched calls for this order
        const { data: matches, error } = await supabase
            .from('call_order_matches')
            .select(`
                telphin_call_id,
                explanation,
                raw_telphin_calls (
                    telphin_call_id,
                    started_at,
                    duration_sec,
                    recording_url,
                    direction,
                    transcript,
                    from_number,
                    to_number,
                    from_number_normalized,
                    to_number_normalized,
                    raw_payload
                )
            `)
            .eq('retailcrm_order_id', orderId)
            .order('raw_telphin_calls(started_at)', { ascending: false });

        if (error) throw error;

        let calls = (matches || [])
            .map((m: any) => {
                if (!m.raw_telphin_calls) return null;
                return {
                    ...m.raw_telphin_calls,
                    match_explanation: m.explanation || '',
                    is_fallback: false
                };
            })
            .filter(Boolean);

        // 2. FALLBACK: If no official matches, search for recent calls by phone
        if (calls.length === 0) {
            // Get order phone
            const { data: order } = await supabase
                .from('orders')
                .select('phone, customer_phones, raw_payload')
                .eq('order_id', orderId)
                .single();

            if (order) {
                const phoneToSearch = order.phone || (order.customer_phones && order.customer_phones[0]) || order.raw_payload?.phone;

                if (phoneToSearch) {
                    const suffix = phoneToSearch.replace(/\D/g, '').slice(-7);
                    if (suffix.length === 7) {
                        const { data: fallbackCalls } = await supabase
                            .from('raw_telphin_calls')
                            .select('*')
                            .or(`from_number.ilike.%${suffix}%,to_number.ilike.%${suffix}%`)
                            .order('started_at', { ascending: false })
                            .limit(10);

                        if (fallbackCalls && fallbackCalls.length > 0) {
                            calls = fallbackCalls.map(c => ({
                                ...c,
                                match_explanation: 'Найден по номеру (ожидает привязки)',
                                is_fallback: true
                            }));
                        }
                    }
                }
            }
        }

        return NextResponse.json({ calls });
    } catch (e: any) {
        console.error('[API Calls] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
