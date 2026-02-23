
// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Техническая расшифровка звонков (Whisper) и AMD.
import OpenAI from 'openai';
import { getTelphinToken } from './telphin';
import { supabase } from '@/utils/supabase';
import { syncRecordingToStorage } from './telphin-storage';

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
        console.log(`[Transcribe] Processing ${callId}...`);

        // 0. Ensure audio is synced to internal storage
        const internalUrl = await syncRecordingToStorage(callId, recordingUrl);
        const sourceUrl = internalUrl || recordingUrl;

        // 1. Download (from internal or external)
        const file = await downloadAudio(sourceUrl);

        // 2. Transcribe (Whisper)
        const openai = getOpenAI();
        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            language: "ru",
            response_format: "text"
        });

        // 3. AMD Classification (only if transcription succeeded)
        let amd: any = null;
        try {
            amd = await analyzeAnsweringMachine(transcription);
        } catch (e) {
            console.error('[Transcribe] AMD failed, skipping classification:', e);
        }

        // 4. Update DB Robustly
        const payload: any = {
            transcript: transcription,
            transcription_status: 'completed'
        };

        if (amd) {
            payload.is_answering_machine = amd.isAnsweringMachine;
            payload.am_detection_result = {
                reason: amd.reason,
                processed_at: new Date().toISOString()
            };
        }

        const tryUpdate = async (col: string, val: any, p: any) => {
            const { data, error } = await supabase
                .from('raw_telphin_calls')
                .update(p)
                .eq(col, val)
                .select();

            if (error && (error.code === '42703' || error.message?.includes('column'))) {
                // Retry without AMD columns
                const { is_answering_machine, am_detection_result, ...fallback } = p;
                return supabase.from('raw_telphin_calls').update(fallback).eq(col, val).select();
            }
            return { data, error };
        };

        // Attempt 1: by UUID (most common for manual)
        let { data, error } = await tryUpdate('telphin_call_id', callId, payload);

        // Attempt 2: by numeric event_id if 1st failed and callId is numeric
        if ((!data || data.length === 0) && /^\d+$/.test(callId)) {
            const numericId = parseInt(callId);
            const secondAttempt = await tryUpdate('event_id', numericId, payload);
            data = secondAttempt.data;
            error = secondAttempt.error;
        }

        if (error) throw error;
        if (!data || data.length === 0) {
            console.warn(`[Transcribe] Transcript generated but no matching row found for ${callId}`);
        } else {
            console.log(`[Transcribe] Successfully updated DB for ${callId}`);
        }

        // 5. Trigger Insight Agent if Match exists
        try {
            const { data: match } = await supabase
                .from('call_order_matches')
                .select('retailcrm_order_id')
                .or(`telphin_call_id.eq.${callId}${/^\d+$/.test(callId) ? `,event_id.eq.${callId}` : ''}`)
                .limit(1)
                .single();

            if (match?.retailcrm_order_id) {
                const { runInsightAnalysis } = await import('./insight-agent');
                runInsightAnalysis(match.retailcrm_order_id).catch(e =>
                    console.error('[InsightAgent] Post-transcribe trigger failed:', e)
                );
            }
        } catch (e) { }

        return transcription;

    } catch (e: any) {
        console.error(`[Transcribe] Failed for ${callId}:`, e.message);

        // Try to mark as failed
        const isNumeric = /^\d+$/.test(callId);
        await supabase.from('raw_telphin_calls').update({ transcription_status: 'failed' }).eq('telphin_call_id', callId);
        if (isNumeric) await supabase.from('raw_telphin_calls').update({ transcription_status: 'failed' }).eq('event_id', parseInt(callId));

        throw e;
    }
}
