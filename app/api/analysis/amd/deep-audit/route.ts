import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';
import { processCallTranscription } from '@/lib/transcription';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '10');

        // 1. Fetch Controlled Managers
        const { data: controlledManagers } = await supabase
            .from('manager_settings')
            .select('id')
            .eq('is_controlled', true);

        const controlledIds = (controlledManagers || []).map(m => m.id.toString());

        if (controlledIds.length === 0) {
            return NextResponse.json({ message: 'No controlled managers selected in settings.' });
        }

        // 2. Find missing transcripts for controlled managers (ALL calls, not just working orders)
        const { data: calls, error: fetchError } = await supabase
            .from('calls')
            .select(`
                id, 
                record_url, 
                duration,
                call_order_matches!inner (
                    orders!inner (
                        manager_id
                    )
                )
            `)
            .is('transcript', null)
            .not('record_url', 'is', null)
            .in('call_order_matches.orders.manager_id', controlledIds)
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (fetchError) throw fetchError;

        if (!calls || calls.length === 0) {
            return NextResponse.json({ message: 'No pending calls found for controlled managers.', count: 0 });
        }

        // 4. Process Batch
        const token = await getTelphinToken();
        const results = [];
        for (const call of calls) {
            console.log(`[DeepAudit] Processing call ${call.id}`);
            const result = await processCallTranscription(call.id, call.record_url!, token);
            results.push({
                id: call.id,
                duration: call.duration,
                ...result
            });
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            details: results
        });

    } catch (e: any) {
        console.error('[DeepAudit API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
