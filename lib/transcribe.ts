
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
 * Production rule: if we have a recording, the call should go through transcription.
 * Only technical absence of media is a valid reason to skip before OpenAI.
 */
export function isTranscribable(call: any, _minDuration: number = 15): boolean {
    return Boolean(call?.recording_url);
}

export async function getTranscriptionMinDuration(): Promise<number> {
    const { data } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', 'transcription_min_duration')
        .maybeSingle();

    const parsed = Number.parseInt(data?.value || '15', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 15;
    }

    return parsed;
}

/**
 * Downloads audio from Telphin (or URL) and converts to File object for OpenAI
 */
async function downloadAudio(recordingUrl: string): Promise<File> {
    // Most storage.telphin.ru links are publicly readable; OAuth is a fallback only.
    let res = await fetch(recordingUrl);

    if ((res.status === 401 || res.status === 403) && !res.ok) {
        let token: string | null = null;
        try {
            token = await getTelphinToken();
        } catch {
            token = null;
        }

        if (token) {
            res = await fetch(recordingUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });
        }
    }

    if (!res.ok) {
        throw new Error(`Audio download failed: ${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();
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

/**
 * Enhances a raw monologue transcript with speaker tags (Manager/Client) using AI
 */
export async function diarizeTranscript(transcript: string): Promise<string> {
    try {
        const openai = getOpenAI();
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert transcript editor. Your goal is to take a raw, one-sided transcript of a phone call (Russian) between a Sales Manager (Менеджер) and a Client (Клиент) and format it as a dialogue.

RULES:
- Identify who is speaking based on the content of the phrases.
- Label them as "Менеджер:" and "Клиент:".
- Mantain the exact same words as in the input, do not summarize.
- If it's a very short call or impossible to distinguish, do your best.
- Typical Manager phrases: "Компания ОКК", "меня зовут...", "какое оборудование?", "выставим счет".
- Typical Client phrases: "я хотел бы узнать цену", "а какие сроки?", "нам нужно для производства".

Output format:
Менеджер: Приветствие...
Клиент: Ответ...
Менеджер: Вопрос...`
                },
                {
                    role: "user",
                    content: `Raw transcript: ${transcript}`
                }
            ],
            temperature: 0
        });

        return response.choices[0].message.content || transcript;
    } catch (e) {
        console.error('[Diarize] AI pass failed, returning raw transcript:', e);
        return transcript;
    }
}

type TranscriptionCallRow = {
    telphin_call_id: string | null;
    event_id: number | null;
    transcription_status: string | null;
    transcript: string | null;
    recording_url: string | null;
    duration_sec?: number | null;
    raw_payload?: Record<string, any> | null;
};

async function loadCallForTranscription(callId: string): Promise<TranscriptionCallRow | null> {
    const { data: byCallId } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload')
        .eq('telphin_call_id', callId)
        .limit(1)
        .maybeSingle();

    if (byCallId) {
        return byCallId;
    }

    if (!/^\d+$/.test(callId)) {
        return null;
    }

    const { data: byEventId } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload')
        .eq('event_id', parseInt(callId, 10))
        .limit(1)
        .maybeSingle();

    return byEventId || null;
}

async function claimCallForTranscription(callId: string): Promise<{ row: TranscriptionCallRow; claimed: boolean }> {
    // Include 'processing' so stale rows from timed-out runs can be re-claimed.
    // Concurrent access is not possible because claim_system_jobs RPC prevents duplicate job dispatch.
    const allowedStates = 'transcription_status.is.null,transcription_status.eq.pending,transcription_status.eq.ready_for_transcription,transcription_status.eq.failed,transcription_status.eq.processing';

    const claimByColumn = async (column: 'telphin_call_id' | 'event_id', value: string | number) => {
        const { data, error } = await supabase
            .from('raw_telphin_calls')
            .update({ transcription_status: 'processing' })
            .eq(column, value)
            .or(allowedStates)
            .is('transcript', null)
            .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload')
            .limit(1);

        if (error) {
            throw error;
        }

        return data?.[0] || null;
    };

    const claimedByCallId = await claimByColumn('telphin_call_id', callId);
    if (claimedByCallId) {
        return { row: claimedByCallId, claimed: true };
    }

    if (/^\d+$/.test(callId)) {
        const claimedByEventId = await claimByColumn('event_id', parseInt(callId, 10));
        if (claimedByEventId) {
            return { row: claimedByEventId, claimed: true };
        }
    }

    const existing = await loadCallForTranscription(callId);
    if (!existing) {
        throw new Error(`Call ${callId} not found in raw_telphin_calls`);
    }

    return { row: existing, claimed: false };
}

export async function getCallTranscriptionPreflight(callId: string) {
    const row = await loadCallForTranscription(callId);
    if (!row) {
        throw new Error(`Call ${callId} not found in raw_telphin_calls`);
    }

    const minDuration = await getTranscriptionMinDuration();
    const transcribable = isTranscribable(row, minDuration);

    return {
        row,
        minDuration,
        transcribable,
        skipReason: transcribable
            ? null
            : 'Skipped before OpenAI: missing recording URL or media payload',
    };
}

export async function markCallTranscriptionSkipped(callId: string, reason: string) {
    const isNumeric = /^\d+$/.test(callId);
    const payload = {
        transcription_status: 'skipped',
        am_detection_result: {
            reason,
            skipped_at: new Date().toISOString(),
        },
    };

    await supabase.from('raw_telphin_calls').update(payload).eq('telphin_call_id', callId);
    if (isNumeric) {
        await supabase.from('raw_telphin_calls').update(payload).eq('event_id', parseInt(callId, 10));
    }
}

export async function transcribeCall(callId: string, recordingUrl: string) {
    let claimedForProcessing = false;

    try {
        console.log(`[Transcribe] Processing ${callId}...`);

        let { row, claimed } = await claimCallForTranscription(callId);

        claimedForProcessing = claimed;

        if (!claimed) {
            if (row.transcription_status === 'completed' && row.transcript) {
                console.log(`[Transcribe] Call ${callId} already completed, skipping duplicate run.`);
                return row.transcript;
            }

            if (row.transcription_status === 'processing') {
                throw new Error(`Call ${callId} is already being transcribed`);
            }

            if (row.transcription_status === 'skipped') {
                throw new Error(`Call ${callId} is marked as skipped`);
            }
        }

        const sourceRecordingUrl = row.recording_url || recordingUrl;
        if (!sourceRecordingUrl) {
            throw new Error(`Call ${callId} has no recording URL`);
        }

        // 0. Ensure audio is synced to internal storage
        const internalUrl = await syncRecordingToStorage(callId, sourceRecordingUrl);
        const sourceUrl = internalUrl || sourceRecordingUrl;

        // 1. Download (from internal or external)
        const file = await downloadAudio(sourceUrl);

        // 2. Transcribe (Whisper)
        const openai = getOpenAI();
        const rawTranscription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            language: "ru",
            response_format: "text"
        });

        // 2.5 Diarization pass (New step)
        console.log(`[Transcribe] Diarizing ${callId}...`);
        const transcription = await diarizeTranscript(rawTranscription);

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
        if (claimedForProcessing) {
            const isNumeric = /^\d+$/.test(callId);
            await supabase.from('raw_telphin_calls').update({ transcription_status: 'failed' }).eq('telphin_call_id', callId);
            if (isNumeric) {
                await supabase.from('raw_telphin_calls').update({ transcription_status: 'failed' }).eq('event_id', parseInt(callId, 10));
            }
        }

        throw e;
    }
}
