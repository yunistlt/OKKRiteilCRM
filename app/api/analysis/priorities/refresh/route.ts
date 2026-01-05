
import { NextResponse } from 'next/server';
import { calculatePriorities } from '@/lib/prioritization';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for full refresh

export async function GET() {
    try {
        console.log('Refreshing priorities...');
        const priorities = await calculatePriorities(2000, true); // Compute heuristics only, fast!

        if (priorities.length === 0) {
            return NextResponse.json({ ok: true, message: 'No orders to update' });
        }

        // Prepare Upsert Data
        const upsertData = priorities.map(p => ({
            order_id: p.orderId,
            level: p.level,
            score: p.score,
            reasons: p.reasons, // Supabase handles array -> jsonb
            summary: p.summary,
            recommended_action: p.recommendedAction || null,
            updated_at: new Date().toISOString()
        }));

        // Batch Upsert
        const chunkSize = 100;
        for (let i = 0; i < upsertData.length; i += chunkSize) {
            const chunk = upsertData.slice(i, i + chunkSize);
            const { error } = await supabase
                .from('order_priorities')
                .upsert(chunk, { onConflict: 'order_id' });

            if (error) {
                console.error('Upsert Error:', error);
                throw error;
            }
        }

        // --- NEW: Cleanup Logic ---
        // Find IDs of all working orders we just processed
        const workingOrderIds = priorities.map(p => p.orderId);

        // Delete priorities for orders that are NOT in the current working batch 
        // AND belong to non-working statuses (to be extra safe, we just delete anything not in active batch)
        if (workingOrderIds.length > 0) {
            // Get all order_ids from table
            const { data: allStored } = await supabase.from('order_priorities').select('order_id');
            const storedIds = (allStored || []).map(s => s.order_id);
            const idsToDelete = storedIds.filter(id => !workingOrderIds.includes(id));

            if (idsToDelete.length > 0) {
                console.log(`Cleaning up ${idsToDelete.length} stale priorities...`);
                // Use chunks for deletion too if necessary
                for (let i = 0; i < idsToDelete.length; i += 200) {
                    const deleteChunk = idsToDelete.slice(i, i + 200);
                    await supabase.from('order_priorities').delete().in('order_id', deleteChunk);
                }
            }
        }

        return NextResponse.json({
            ok: true,
            count: priorities.length,
            message: 'Priorities refreshed'
        });
    } catch (e: any) {
        console.error('[Refresh Priorities] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
