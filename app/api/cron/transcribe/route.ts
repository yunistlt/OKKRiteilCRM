
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeCall, isTranscribable } from '@/lib/transcribe';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';

// Vercel Cron protection (optional, but good practice)
// function verifyCron(req: Request) { ... }

export async function GET(req: Request) {
    try {
        // 1. Fetch Candidates
        // "pending" status AND has recording_url
        // Limit to 5 per run to avoid timeout/limits
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
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

                // Trigger Rule Engine for this specific call?
                // Or let the global rule engine interval pick it up?
                // For "Semantic Rules", we need to run them NOW because they depend on text.
                // TODO: Trigger Semantic Analysis here.
            } catch (e: any) {
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
