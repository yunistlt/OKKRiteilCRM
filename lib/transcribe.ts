
import OpenAI from 'openai';
import { getTelphinToken } from './telphin';
import { supabase } from '@/utils/supabase';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

export async function transcribeCall(callId: string, recordingUrl: string) {
    try {
        console.log(`[Transcribe] Processing call ${callId}...`);

        // 1. Download
        const file = await downloadAudio(recordingUrl);

        // 2. Transcribe (Whisper)
        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            language: "ru", // Force Russian for better quality
            response_format: "text"
        });

        // 3. Update DB
        await supabase
            .from('raw_telphin_calls')
            .update({
                transcript: transcription,
                transcription_status: 'completed'
            })
            .eq('event_id', callId); // Using internal event_id

        console.log(`[Transcribe] Success for ${callId}`);
        return transcription;

    } catch (e: any) {
        console.error(`[Transcribe] Failed for ${callId}:`, e);

        await supabase
            .from('raw_telphin_calls')
            .update({
                transcription_status: 'failed',
                // store error? Maybe in a log table, but for now just status.
            })
            .eq('event_id', callId);

        throw e;
    }
}
