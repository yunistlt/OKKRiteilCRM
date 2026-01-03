import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Helper: Get normalized 10 digits
const normalizePhone = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const clean = p.replace(/[^\d]/g, '');
    if (clean.length === 0) return null;
    if (clean.length === 11 && (clean.startsWith('7') || clean.startsWith('8'))) {
        return clean.slice(1);
    }
    return clean;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('order');
    const callId = searchParams.get('call_id');

    try {
        if (callId) {
            // CALL-CENTRIC DEBUG (10-digit Variations)
            const { data: call } = await supabase.from('calls').select('*').eq('id', callId).single();
            if (!call) return NextResponse.json({ error: "Call not found" });

            const potentialNumbers = new Set<string>();
            const details = [];

            // Extract 10-digit normalized
            if (call.client_number) {
                const n = normalizePhone(call.client_number);
                if (n) { potentialNumbers.add(n); details.push({ src: 'client_number', val: call.client_number, norm: n }); }
            }
            if (call.driver_number) {
                const n = normalizePhone(call.driver_number);
                if (n) { potentialNumbers.add(n); details.push({ src: 'driver_number', val: call.driver_number, norm: n }); }
            }
            if (call.raw_data) {
                try {
                    const raw = typeof call.raw_data === 'string' ? JSON.parse(call.raw_data) : call.raw_data;
                    ['from_username', 'to_username', 'ani_number', 'dest_number'].forEach(f => {
                        if (raw[f]) {
                            const n = normalizePhone(raw[f]);
                            if (n) { potentialNumbers.add(n); details.push({ src: f, val: raw[f], norm: n }); }
                        }
                    });
                } catch (e) { }
            }

            // Generate Variations to handle +7/8 prefix stored in DB
            const expandedPhones = new Set<string>();
            potentialNumbers.forEach(p => {
                expandedPhones.add(p);
                expandedPhones.add(`7${p}`); // +7...
                expandedPhones.add(`8${p}`); // 8...
            });

            const searchPatterns = Array.from(expandedPhones);

            // Query Orders using overlaps
            const { data: foundOrders, error } = await supabase
                .from('orders')
                .select('order_id, number, created_at, customer_phones')
                .overlaps('customer_phones', searchPatterns)
                .order('created_at', { ascending: false });

            return NextResponse.json({
                call: {
                    id: call.id,
                    timestamp: call.timestamp,
                    variations_searched: searchPatterns,
                    details: details
                },
                search_query_error: error,
                found_orders_count: foundOrders?.length || 0,
                found_orders: foundOrders
            });
        }

        if (!orderNumber) return NextResponse.json({ error: "Provide ?order=NUMBER or ?call_id=UUID" });

        return NextResponse.json({ message: "Legacy order debugger deprecated" });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
