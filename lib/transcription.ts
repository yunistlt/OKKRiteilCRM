import { OpenAI } from 'openai';
import { supabase } from '@/utils/supabase';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Downloads audio from Telphin Storage
 */
async function downloadAudio(url: string, telphinToken: string): Promise<Buffer> {
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${telphinToken}` }
    });
    if (!res.ok) throw new Error(`Failed to download audio: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * Transcribes audio using OpenAI Whisper
 */
async function transcribe(audioBuffer: Buffer): Promise<string> {
    // Convert Buffer to a File object compatible with OpenAI SDK
    const file = await OpenAI.toFile(audioBuffer, 'audio.mp3', { type: 'audio/mpeg' });

    const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
    });

    return transcription.text;
}

/**
 * Classifies if the transcript sounds like an answering machine
 */
async function analyzeAnsweringMachine(transcript: string): Promise<{ isAnsweringMachine: boolean; reason: string }> {
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
}

/**
 * Main entry point to process a call record
 */
export async function processCallTranscription(callId: string, recordUrl: string, telphinToken: string) {
    console.log(`[AMD] Processing call ${callId}...`);

    try {
        // 1. Download
        const audio = await downloadAudio(recordUrl, telphinToken);

        // 2. Transcribe
        const text = await transcribe(audio);

        // 3. Classify
        const classification = await analyzeAnsweringMachine(text);

        // 4. Update Supabase
        const { error } = await supabase
            .from('calls')
            .update({
                transcript: text,
                is_answering_machine: classification.isAnsweringMachine,
                am_detection_result: {
                    reason: classification.reason,
                    processed_at: new Date().toISOString()
                }
            })
            .eq('id', callId);

        if (error) throw error;

        return { success: true, isAnsweringMachine: classification.isAnsweringMachine };
    } catch (e: any) {
        console.error(`[AMD] Error processing call ${callId}:`, e);
        return { success: false, error: e.message };
    }
}
