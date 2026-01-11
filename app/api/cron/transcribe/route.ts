
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeCall, isTranscribable } from '@/lib/transcribe';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';

// Vercel Cron protection (optional, but good practice)
// function verifyCron(req: Request) { ... }

export async function GET(req: Request) {
    try {
        // Only process calls from the last 30 days to reduce costs
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 1. Fetch Transcribable Statuses
        const { data: statusSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        const transcribableStatuses = statusSettings?.map(s => s.code) || [];

        if (transcribableStatuses.length === 0) {
            return NextResponse.json({ message: 'No statuses configured for transcription.' });
        }

        // 2. Fetch Candidates
        // Only fetch calls that:
        // - are in 'pending' transcription status
        // - have a recording URL
        // - were started in the last 30 days
        // - are matched to an order with a 'transcribable' status
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select(`
                *,
                matches:call_order_matches!inner(
                    retailcrm_order_id,
                    orders:orders!inner(status)
                )
            `)
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .in('matches.orders.status', transcribableStatuses)
            .order('started_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('[Cron] Fetch candidates error:', error);
            throw new Error(error.message);
        }

        if (!calls || calls.length === 0) {
            return NextResponse.json({ message: 'No transcribable pending calls found.' });
        }

        const results = [];

        for (const call of calls) {
            // Check viability (duration, etc)
            if (!isTranscribable(call)) {
                console.log(`[Cron] Skipping call ${call.event_id} (Not viable)`);
                await supabase
                    .from('raw_telphin_calls')
                    .update({ transcription_status: 'skipped' })
                    .eq('event_id', call.event_id);
                results.push({ id: call.event_id, status: 'skipped' });
                continue;
            }

            // Transcribe
            try {
                await transcribeCall(call.event_id, call.recording_url);
                results.push({ id: call.event_id, status: 'success' });

                // Trigger Semantic Analysis immediately
                // Fetch active semantic rules
                const { data: rules } = await supabase
                    .from('okk_rules')
                    .select('*')
                    .eq('is_active', true)
                    .eq('rule_type', 'semantic');

                if (rules && rules.length > 0) {
                    console.log(`[Cron] Triggering ${rules.length} semantic rules for call ${call.event_id}`);
                    const { runRuleEngine } = await import('@/lib/rule-engine');

                    // We define a narrow window around the call to ensure it's picked up by the engine's query logic
                    // The Rule Engine query uses: started_at >= start AND started_at <= end
                    // So passing the exact time is safe.
                    await runRuleEngine(call.started_at, call.started_at);
                }

                results.push({ id: call.event_id, status: 'success' });
            } catch (e: any) {
                console.error(`[Cron] Transcribe/Analyze failed for ${call.event_id}:`, e);
                results.push({ id: call.event_id, status: 'error', error: e.message });
            }
        }

        return NextResponse.json({
            processed: results.length,
            details: results
        });

    } catch (e: any) {
        console.error('Transcription Cron Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
