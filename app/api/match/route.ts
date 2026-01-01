import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Helper to normalize phone numbers just in case
const cleanPhone = (p: string) => p.replace(/[^\d]/g, '');

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true'; // Re-check all if true

    try {
        // 1. Fetch Orders that need matching (or all if force)
        // We look for orders created recently or unlinked
        const orderQuery = supabase
            .from('orders')
            .select('*')
            .order('createdat', { ascending: false })
            .limit(100); // Process in batches

        if (!force) {
            // Optimization: only look at orders without call_id
            // Note: If you want to match OLD orders, remove this filter or use force
            // orderQuery.is('call_id', null); 
        }

        const { data: orders, error: oError } = await orderQuery;

        if (oError) throw oError;
        if (!orders || orders.length === 0) return NextResponse.json({ message: 'No orders to match' });

        let matchCount = 0;
        const matches = [];

        // 2. Iterate orders and find calls
        for (const order of orders) {
            if (!order.customer_phones || order.customer_phones.length === 0) continue;

            // Search for calls that match ANY of the customer's phones
            // Logic: call.client_number IN order.customer_phones OR call.driver_number IN order.customer_phones
            // And time window: let's say +/- 24 hours around order creation

            const orderDate = new Date(order.createdat);
            const timeWindow = 24 * 60 * 60 * 1000; // 24 hours
            const minDate = new Date(orderDate.getTime() - timeWindow).toISOString();
            const maxDate = new Date(orderDate.getTime() + timeWindow).toISOString();

            // Postgres query for overlap is tricky with arrays on both sides.
            // Simpler approach: Fetch calls in time window, then filter in JS or use 'in' filter

            const { data: candidateCalls } = await supabase
                .from('calls')
                .select('*')
                .gte('timestamp', minDate)
                .lte('timestamp', maxDate);

            if (!candidateCalls) continue;

            // Find best match with fuzzy logic for RU numbers (7 vs 8)
            const normalizeForMatch = (p: string) => {
                if (!p) return '';
                let clean = p.replace(/[^\d]/g, '');
                // If 11 digits and starts with 7 or 8, remove it to compare last 10
                if (clean.length === 11 && (clean.startsWith('7') || clean.startsWith('8'))) {
                    return clean.slice(1);
                }
                return clean;
            };

            const matchedCall = candidateCalls.find(call => {
                if (!call.client_number) return false;

                const callNum = normalizeForMatch(call.client_number);

                // Check against all customer phones
                return order.customer_phones.some((orderPhone: string) => {
                    return normalizeForMatch(orderPhone) === callNum;
                });
            });

            if (matchedCall) {
                // INSERT MATCH
                // We link the Call to the Order (conceptually), not just one event.
                // But we use the order_id from the current event.

                await supabase.from('matches').insert({
                    order_id: order.order_id, // The CRM ID (e.g. 12345)
                    call_id: matchedCall.id,  // The Call UUID
                    score: 1.0,               // High confidence (exact/fuzzy match)
                    event_id: order.id        // The specific event we found the match on (optional context)
                });

                matches.push({
                    order_number: order.number,
                    order_id: order.order_id,
                    call: matchedCall.id,
                    phone: matchedCall.client_number
                });
                matchCount++;
            }
        }

        return NextResponse.json({
            success: true,
            matches_found: matchCount,
            details: matches
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
