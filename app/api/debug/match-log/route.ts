import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { normalizePhone } from '@/lib/phone-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    try {
        log('Starting debug match...');

        // 1. Fetch recent calls from raw_telphin_calls
        // Check if table is correct
        const { data: calls, error: callsError } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .order('started_at', { ascending: false })
            .limit(5);

        if (callsError) {
            log(`Error fetching calls: ${callsError.message}`);
            throw callsError;
        }

        log(`Fetched ${calls?.length} recent calls.`);

        if (!calls || calls.length === 0) {
            return NextResponse.json({ logs });
        }

        // 2. Process first 3 calls to debug matching
        for (const call of calls.slice(0, 3)) {
            log(`\n--- Processing Call ${call.telphin_call_id} ---`);
            log(`From: ${call.from_number}, To: ${call.to_number}, Direction: ${call.direction}`);

            const clientPhone = call.direction === 'incoming' ? call.from_number : call.to_number;
            const normalized = normalizePhone(clientPhone);
            log(`Client Phone: ${clientPhone} -> Normalized: ${normalized}`);

            if (!normalized) {
                log('Skipping: No normalized phone');
                continue;
            }

            const suffix = normalized.replace(/\D/g, '').slice(-7);
            log(`Suffix for search: ${suffix}`);

            // A. Search in RAW_ORDER_EVENTS
            // This is the primary method used in lib/call-matching.ts
            log(`Searching raw_order_events for phone_normalized=${normalized}...`);
            const { data: events, error: evError } = await supabase
                .from('raw_order_events')
                .select('retailcrm_order_id, phone_normalized')
                .or(`phone_normalized.eq.${normalized},additional_phone_normalized.eq.${normalized}`)
                .order('occurred_at', { ascending: false })
                .limit(5);

            if (evError) log(`Events Error: ${evError.message}`);
            log(`Events found: ${events?.length || 0}`);
            if (events && events.length > 0) {
                log(`Example event matches: ${JSON.stringify(events[0])}`);
            }

            // B. Search in ORDERS (Fallback)
            log(`Searching orders for phone ILIKE %${suffix}...`);
            const { data: orders, error: ordError } = await supabase
                .from('orders')
                .select('id, phone, customer_phones')
                .ilike('phone', `%${suffix}`)
                .limit(5);

            if (ordError) log(`Orders Error: ${ordError.message}`);
            log(`Orders found: ${orders?.length || 0}`);
            if (orders && orders.length > 0) {
                log(`Example order match: ID=${orders[0].id}, Phone=${orders[0].phone}`);
            }
        }

        return NextResponse.json({ logs });

    } catch (error: any) {
        log(`FATAL ERROR: ${error.message}`);
        return NextResponse.json({ logs, error: error.message }, { status: 500 });
    }
}
