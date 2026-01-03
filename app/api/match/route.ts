import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';
import { processCallTranscription } from '@/lib/transcription';

export const maxDuration = 300;

// Helper to normalize phone numbers just in case
const normalizePhone = (p: string | null | undefined): string | null => {
    // ... (rest of normalizePhone stays the same)
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
    const limit = parseInt(searchParams.get('limit') || '20'); // Reduced default for safety
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        // 0. Fetch Working Statuses
        const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
        const workingCodes = new Set((workingSettings || []).map(s => s.code));

        // 1. Get IDs of already matched calls to exclude them
        const { data: matchedRows } = await supabase.from('matches').select('call_id');
        const matchedCallIds = new Set((matchedRows || []).map(m => m.call_id));

        // 2. Fetch Sync of Calls
        const { data: calls, error: cError } = await supabase
            .from('calls')
            .select('*')
            .order('timestamp', { ascending: false })
            .range(offset, offset + (limit * 4));

        if (cError) throw cError;
        if (!calls || calls.length === 0) return NextResponse.json({ message: 'No calls found' });

        const callsToProcess = calls.filter(c => !matchedCallIds.has(c.id)).slice(0, limit);
        if (callsToProcess.length === 0) {
            return NextResponse.json({ message: 'No unmatched calls', processed: 0 });
        }

        const telphinToken = await getTelphinToken();
        let matchCount = 0;
        const results = [];

        // 3. Process each call
        for (const call of callsToProcess) {
            // ... (Potential numbers extraction remains the same)
            const potentialNumbers = new Set<string>();
            if (call.client_number) { const n = normalizePhone(call.client_number); if (n) potentialNumbers.add(n); }
            if (call.driver_number) { const n = normalizePhone(call.driver_number); if (n) potentialNumbers.add(n); }
            if (call.raw_data) {
                try {
                    const raw = typeof call.raw_data === 'string' ? JSON.parse(call.raw_data) : call.raw_data;
                    ['from_username', 'to_username', 'ani_number', 'dest_number'].forEach(f => {
                        const n = normalizePhone(raw[f]); if (n) potentialNumbers.add(n);
                    });
                } catch (e) { }
            }
            if (potentialNumbers.size === 0) continue;

            const expandedPhones = Array.from(potentialNumbers).flatMap(p => [p, `7${p}`, `8${p}`]);

            // 4. Find Order
            const { data: foundOrders } = await supabase
                .from('orders')
                .select('order_id, number, created_at, customer_phones, status')
                .overlaps('customer_phones', expandedPhones)
                .order('created_at', { ascending: false })
                .limit(1);

            if (foundOrders && foundOrders.length > 0) {
                const bestOrder = foundOrders[0];

                // 5. Create Match
                const { error: insertError } = await supabase.from('matches').insert({
                    order_id: bestOrder.order_id,
                    call_id: call.id,
                    score: 1.0
                });

                if (!insertError) {
                    matchCount++;
                    let amdResult = null;

                    // 6. AUTO-TRANSCRIPTION: If status is working, process AMD
                    if (workingCodes.has(bestOrder.status)) {
                        console.log(`[AutoAMD] Triggering for call ${call.id} (Order ${bestOrder.number})`);
                        if (call.record_url) {
                            amdResult = await processCallTranscription(call.id, call.record_url, telphinToken);
                        }
                    }

                    results.push({
                        call_id: call.id,
                        order_number: bestOrder.number,
                        status: bestOrder.status,
                        transcribed: !!amdResult?.success,
                        is_answering_machine: amdResult?.isAnsweringMachine
                    });
                }
            }
        }

        return NextResponse.json({
            success: true,
            processed_calls: callsToProcess.length,
            matches_found: matchCount,
            details: results
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
