
import OpenAI from 'openai';
import { getTelphinToken } from './telphin';
import { supabase } from '@/utils/supabase';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return _openai;
}

/**
 * Validates if the call is suitable for transcription
 */
export function isTranscribable(call: any, minDuration: number = 15): boolean {
    const duration = call.duration_sec || 0;
    const isSuccess = call.status === 'success' || (duration > 0);
    // Usually 'success' status is best, but we rely on duration too.

    // Skip short calls (usually silence or answering machine hangup)
    // Save money by ignoring < minDuration (default 15s)
    if (duration < minDuration) return false;

    if (!call.recording_url) return false;

    return true;
}

/**
 * Downloads audio from Telphin (or URL) and converts to File object for OpenAI
 */
async function downloadAudio(recordingUrl: string): Promise<File> {
    // If URL is internal Telphin, we might need Auth headers.
    // Usually Telphin recording_url is accessible if we have the link, 
    // OR we need to fetch binary with Token.

    const token = await getTelphinToken();

    // Assume recording_url is full URL. If relative, prepend host.
    // Telphin API usually returns "https://..." or relative.
    // If we need to sign it, we use the token.

    // Official Telphin docs: GET /api/ver1.0/client/@me/record/{uuid}/storage
    // BUT our 'recording_url' in DB might be just the UUID or full Link.
    // Let's assume it's a fetchable link for now, adding Bearer just in case.

    const res = await fetch(recordingUrl, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) {
        throw new Error(`Audio download failed: ${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();
    // Convert Blob to File (Node.js compabitility for OpenAI SDK)
    return new File([blob], 'audio.mp3', { type: 'audio/mpeg' });
}

/**
 * Classifies if the transcript sounds like an answering machine
 */
async function analyzeAnsweringMachine(transcript: string): Promise<{ isAnsweringMachine: boolean; reason: string }> {
    try {
        const openai = getOpenAI();
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Cost efficient for classification
            messages: [
                {
                    role: "system",
                    content: `You are an expert call analyzer. Analyze the transcript of a phone call (Russian) and determine if the recipient is a human or an Answering Machine / Carrier Message. 
                    
                    CRITICAL RULE:
                    - If there is a DIALOGUE (back-and-forth conversation between two real people), it is ALWAYS a "isAnsweringMachine": false (Human), even if the call started with an automated greeting or "Оставайтесь на линии".
                    
                    Signals of Answering Machine / System Message (ONLY if NO human dialogue follows):
                    - Technical phrases: "Оставьте сообщение после сигнала", "Вас приветствует автоответчик", "В данный момент я не могу ответить", "Перезвоните позже", "Абонент временно недоступен", "Не будем дозваниваться", "Оставайтесь на линии".
                    - One-sided system greetings or technical announcements without a second person answering.
                    - Music or silence followed by a hangup.
                    
                    Respond in JSON format: { "isAnsweringMachine": boolean, "reason": "string" }`
                },
                {
                    role: "user",
                    content: `Transcript: ${transcript}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');
        return {
            isAnsweringMachine: !!result.isAnsweringMachine,
            reason: result.reason || 'Analyzed by AI'
        };
    } catch (e) {
        console.error('[AMD] Classification failed:', e);
        return { isAnsweringMachine: false, reason: 'Analysis failed' };
    }
}

export async function transcribeCall(callId: string, recordingUrl: string) {
    try {
        // 1. Download
        const file = await downloadAudio(recordingUrl);

        // 2. Transcribe (Whisper)
        const openai = getOpenAI();
        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            language: "ru",
            response_format: "text"
        });

        // 3. Optional: AMD Classification (only if text is short or suspicious?) 
        // For now, let's always do it if version 1.2+
        const amd = await analyzeAnsweringMachine(transcription);

        // 4. Update DB
        const { error, count, data } = await supabase
            .from('raw_telphin_calls')
            .update({
                transcript: transcription,
                transcription_status: 'completed',
                // We store AMD in raw_payload if columns don't exist, 
                // but let's try to update them as if they exist (or use jsonb merge)
                is_answering_machine: amd.isAnsweringMachine,
                am_detection_result: {
                    reason: amd.reason,
                    processed_at: new Date().toISOString()
                }
            })
            .eq('event_id', callId)
            .select(); // Select to see if rows matched

        let successUpdate = !error && ((count !== null && count > 0) || ((data as any)?.length > 0));

        // Fallback: Try ID as telphin_call_id (UUID)
        if (!successUpdate && !error) {
            const { error: uuidError, data: uuidData } = await supabase
                .from('raw_telphin_calls')
                .update({
                    transcript: transcription,
                    transcription_status: 'completed',
                    is_answering_machine: amd.isAnsweringMachine,
                    am_detection_result: {
                        reason: amd.reason,
                        processed_at: new Date().toISOString()
                    }
                })
                .eq('telphin_call_id', callId)
                .select();

            if (!uuidError && (uuidData as any)?.length > 0) {
                successUpdate = true;
            }
        }


        if (error) {
            // Handle missing columns by falling back to transcript only
            // Supabase/PostgREST might return 42703 or a message about missing column
            if (error.code === '42703' || error.message?.includes('am_detection_result') || error.message?.includes('column')) {
                console.warn('[Transcribe] AMD columns missing, saving only transcript...');
                const { error: matchError, count: matchCount, data: matchData } = await supabase
                    .from('raw_telphin_calls')
                    .update({
                        transcript: transcription,
                        transcription_status: 'completed'
                    })
                    .eq('event_id', callId)
                    .select();

                // If that also failed (0 rows), try telphin_call_id
                if (!matchError && (!matchData || (matchData as any).length === 0)) {
                    const { error: uuidError2, data: uuidData2 } = await supabase
                        .from('raw_telphin_calls')
                        .update({
                            transcript: transcription,
                            transcription_status: 'completed'
                        })
                        .eq('telphin_call_id', callId)
                        .select();
                }
            } else {
                throw error;
            }
        }

        // 5. Trigger Insight Agent if Match exists
        try {
            const { data: match } = await supabase
                .from('call_order_matches')
                .select('retailcrm_order_id')
                .or(`telphin_call_id.eq.${callId},event_id.eq.${callId}`)
                .limit(1)
                .single();

            if (match?.retailcrm_order_id) {
                const { runInsightAnalysis } = await import('./insight-agent');
                // Background execution (fire and forget)
                runInsightAnalysis(match.retailcrm_order_id).catch(e =>
                    console.error('[InsightAgent] Post-transcribe trigger failed:', e)
                );
            }
        } catch (e) {
            // Silence match errors (might not be an order-related call)
        }

        return transcription;

    } catch (e: any) {
        console.error(`[Transcribe] Failed for ${callId}:`, e);

        await supabase
            .from('raw_telphin_calls')
            .update({
                transcription_status: 'failed',
            })
            .eq('event_id', callId);

        throw e;
    }
}
