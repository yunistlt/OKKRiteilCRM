
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { matchCallToOrders, saveMatches, RawCall } from '@/lib/call-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min timeout

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const forceStart = searchParams.get('start');

        const storageKey = 'matching_backfill_cursor';
        const BACKFILL_START_DATE = '2025-09-01T00:00:00Z';
        const BACKFILL_END_DATE = '2025-12-01T23:59:59Z';
        const BATCH_SIZE = 50; // Moderate batch

        // 1. Get Cursor
        let cursor = BACKFILL_START_DATE;
        if (forceStart) {
            cursor = forceStart;
        } else {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) cursor = state.value;
        }

        // Check completion
        if (new Date(cursor) >= new Date(BACKFILL_END_DATE)) {
            await updateState(storageKey, cursor); // Refresh timestamp
            return NextResponse.json({
                status: 'completed',
                message: 'Matching backfill complete.',
                cursor
            });
        }

        console.log(`[Match Backfill] Processing from ${cursor}...`);

        // 2. Fetch calls > cursor
        // We simply process time-ordered calls. 
        // We DON'T filter by "unmatched" in the query because Supabase join synthax is tricky for "IS NULL".
        // Instead, we just process all calls in the window. 
        // `saveMatches` is idempotent (upsert), so re-matching is safe.
        // This ensures we verify every call in history.

        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .gt('started_at', cursor)
            .lte('started_at', BACKFILL_END_DATE)
            .order('started_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) throw error;

        if (!calls || calls.length === 0) {
            // No more calls in this range? Or we reached end?
            // If query returned 0, it means we exceeded max date or no data.
            // Let's assume we are done or need to jump to end.
            // We can check if cursor < DEC 1. If yes, and no calls, maybe gap?
            // Logic: If no calls returned, we might be at the end.

            // BUT: We restricted LTE end_date. 
            // If no calls found, we are effectively done for this period or stuck in a void.
            // Safest: set cursor to End Date if no calls found?
            // Or just return "idle".

            return NextResponse.json({
                status: 'idle',
                message: 'No more calls found in range.',
                cursor
            });
        }

        let matchesTotal = 0;
        let lastCallTime = cursor;

        // 3. Process
        for (const call of calls) {
            const matches = await matchCallToOrders(call as RawCall);
            if (matches.length > 0) {
                await saveMatches(matches);
                matchesTotal += matches.length;
            }
            lastCallTime = call.started_at; // Advance cursor to this call
        }

        // 4. Update Cursor
        await updateState(storageKey, lastCallTime);

        return NextResponse.json({
            success: true,
            processed: calls.length,
            matches_found: matchesTotal,
            next_cursor: lastCallTime,
            progress: `${calls.length} calls processed. Cursor: ${lastCallTime}`
        });

    } catch (error: any) {
        console.error('Match Backfill Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function updateState(key: string, value: string) {
    await supabase.from('sync_state').upsert({
        key,
        value,
        updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
}
