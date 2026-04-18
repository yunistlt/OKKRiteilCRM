
// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { isSystemJobsPipelineRuntimeEnabled, safeEnqueueCallSemanticRulesJob } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { transcribeCall, isTranscribable } from '@/lib/transcribe';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'fallback.transcription';

function ensureAuthorized(req: Request) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

export async function GET(req: Request) {
    try {
        ensureAuthorized(req);
        const { searchParams } = new URL(req.url);
        const force = searchParams.get('force') === 'true';
        const realtimePipelineEnabled = await isSystemJobsPipelineRuntimeEnabled();

        if (realtimePipelineEnabled && !force) {
            await recordWorkerSuccess(WORKER_KEY, { status: 'skipped', reason: 'realtime_owned' });
            return NextResponse.json({
                ok: true,
                status: 'skipped',
                reason: 'Realtime transcription queue owns processing. Use force=true for emergency fallback run.',
            });
        }

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
            await recordWorkerSuccess(WORKER_KEY, { status: 'idle', reason: 'no_transcribable_statuses' });
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
            .in('transcription_status', ['pending', 'ready_for_transcription'])
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .in('matches.orders.status', transcribableStatuses)
            .order('started_at', { ascending: false })
            .limit(10); // Reduced to 10 to avoid timeouts

        if (error) {
            console.error('[Cron] Fetch candidates error:', error);
            throw new Error(error.message);
        }

        // [Heartbeat] Update sync_state early to signal start
        await supabase
            .from('sync_state')
            .upsert({
                key: 'transcription_last_run',
                value: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (!calls || calls.length === 0) {
            await recordWorkerSuccess(WORKER_KEY, { status: 'idle', processed: 0, reason: 'no_calls' });
            return NextResponse.json({ message: 'No transcribable ready calls found.' });
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
                    if (realtimePipelineEnabled) {
                        await safeEnqueueCallSemanticRulesJob({
                            callId: call.telphin_call_id || String(call.event_id),
                            source: 'legacy_transcribe_cron',
                            payload: {
                                retailcrm_order_ids: (call.matches || []).map((match: any) => match.retailcrm_order_id),
                            },
                            priority: 20,
                        });
                        console.log(`[Cron] Enqueued semantic rules for call ${call.event_id} into system jobs pipeline`);
                    } else {
                        console.log(`[Cron] Triggering ${rules.length} semantic rules for call ${call.event_id}`);
                        await runRuleEngine(call.started_at, call.started_at, undefined, false, undefined, undefined, undefined, {
                            ruleType: 'semantic',
                            entityType: 'call',
                            targetCallId: call.telphin_call_id || String(call.event_id),
                        });
                    }
                }

                results.push({ id: call.event_id, status: 'success' });
            } catch (e: any) {
                console.error(`[Cron] Transcribe/Analyze failed for ${call.event_id}:`, e);
                results.push({ id: call.event_id, status: 'error', error: e.message });
            }
        }

        await recordWorkerSuccess(WORKER_KEY, {
            status: 'completed',
            processed: results.length,
            errors: results.filter((item: any) => item.status === 'error').length,
        });

        return NextResponse.json({
            processed: results.length,
            details: results
        });

    } catch (e: any) {
        console.error('Transcription Cron Error:', e);
        if (e.message !== 'Unauthorized') {
            await recordWorkerFailure(WORKER_KEY, e.message || 'Unknown transcription fallback error');
        }
        const isUnauthorized = e.message === 'Unauthorized';
        return NextResponse.json({ error: e.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
