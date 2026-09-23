/**
 * Текст → речь. Зеркало `lib/transcribe.ts`.
 *
 * Свой self-hosted TTS-сервер (Silero) — бесплатно, без внешних ключей и без
 * DPI, по тем же причинам, по которым у нас свой STT (см. docs/shtab/TAMARA.md,
 * раздел «Диктовка»). Контракт сервера и его установка — ops/tts/README.md.
 *
 * Голос Тамары — `kseniya` (выбран прослушиванием 23.09.2026).
 *
 * Мягкая деградация здесь означает «не настроено → null», а НЕ «молча
 * проглотили ошибку»: у озвучки нет второго провайдера, и текстовый канал
 * работает сам по себе. Ошибки самого сервера бросаются наверх.
 */

import { normalizeForSpeech } from '@/lib/speech-text';

const TTS_URL = process.env.TTS_URL;
const TTS_TOKEN = process.env.TTS_TOKEN;
const TTS_VOICE = process.env.TTS_VOICE || 'kseniya';
const TTS_TIMEOUT_MS = 255000;

/** Телеграм режет голосовые больше 50 МБ; наш реальный потолок много ниже. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export type SpeechFormat = 'ogg' | 'wav';

export type SpeechResult = {
    /** Готовое аудио. */
    audio: Uint8Array;
    format: SpeechFormat;
    /** Текст, который реально пошёл в синтез (после нормализации чисел). */
    spokenText: string;
    voice: string;
};

export function isTtsConfigured(): boolean {
    return !!TTS_URL;
}

function ttsHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TTS_TOKEN) headers['X-Auth-Token'] = TTS_TOKEN;
    return headers;
}

/**
 * Озвучивает текст. Возвращает null, если TTS не настроен — вызывающий просто
 * отправляет текст без голоса.
 *
 * `text` прогоняется через normalizeForSpeech: Silero читает «2 140 000 ₽»
 * заметно хуже, чем «два миллиона сто сорок тысяч рублей».
 */
export async function synthesizeSpeech(
    text: string,
    opts?: { voice?: string; format?: SpeechFormat; normalize?: boolean },
): Promise<SpeechResult | null> {
    if (!isTtsConfigured()) return null;

    const spokenText = opts?.normalize === false ? text : normalizeForSpeech(text);
    if (!spokenText.trim()) return null;

    const voice = opts?.voice || TTS_VOICE;
    const format: SpeechFormat = opts?.format || 'ogg';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
    try {
        const res = await fetch(`${TTS_URL!.replace(/\/+$/, '')}/tts`, {
            method: 'POST',
            headers: ttsHeaders(),
            body: JSON.stringify({ text: spokenText, speaker: voice, format }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`TTS server ${res.status}: ${body.substring(0, 200) || res.statusText}`);
        }

        const audio = new Uint8Array(await res.arrayBuffer());
        if (audio.byteLength === 0) throw new Error('TTS server вернул пустое аудио');
        if (audio.byteLength > MAX_AUDIO_BYTES) {
            throw new Error(`TTS: аудио ${audio.byteLength} байт, лимит ${MAX_AUDIO_BYTES}`);
        }
        return { audio, format, spokenText, voice };
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`TTS server timeout after ${TTS_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}
