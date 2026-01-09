
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

        // 1. Fetch Candidates
        // "pending" status AND has recording_url
        // Limit to 5 per run to avoid timeout/limits
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString()) // Only last 30 days
            .order('started_at', { ascending: false }) // Process newest first? Or oldest? Newest provides faster feedback.
            .limit(5);

        if (error) throw new Error(error.message);
        if (!calls || calls.length === 0) {
            return NextResponse.json({ message: 'No pending calls found.' });
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
