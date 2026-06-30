
// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Техническая расшифровка звонков (Whisper) и AMD.
import OpenAI from 'openai';
import { getTelphinToken } from './telphin';
import { supabase } from '@/utils/supabase';
import { syncRecordingToStorage } from './telphin-storage';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return _openai;
}

// Свой self-hosted STT-сервер (whisper) — бесплатная альтернатива OpenAI Whisper.
// Контракт: POST {STT_URL}/transcribe, multipart (file + language), заголовок X-Auth-Token
// (если задан STT_TOKEN). Ответ: { text, segments }.
const STT_URL = process.env.STT_URL;
const STT_TOKEN = process.env.STT_TOKEN;
// Расшифровка длинного аудио на CPU может быть долгой. Оставляем запас от maxDuration роута (300с)
// на пост-обработку (диаризация/AMD/запись в БД), чтобы функцию не убило после успешного STT.
const STT_TIMEOUT_MS = 255000;

export function isSelfHostedSttConfigured(): boolean {
    return !!STT_URL;
}

// «Перевёрнутый» режим: STT-сервер сам забирает звонки через /api/stt/claim (геоблок не пускает
// Vercel в РФ). В этом режиме воркер транскрибации ничего не пушит — только закрывает джобу.
export function isSttPullMode(): boolean {
    return process.env.STT_PULL_MODE === '1' || process.env.STT_PULL_MODE === 'true';
}

async function transcribeViaSttServer(file: File): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
        const form = new FormData();
        form.append('file', file, 'audio.mp3');
        form.append('language', 'ru');

        const headers: Record<string, string> = {};
        if (STT_TOKEN) headers['X-Auth-Token'] = STT_TOKEN;

        const res = await fetch(`${STT_URL!.replace(/\/+$/, '')}/transcribe`, {
            method: 'POST',
            body: form,
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`STT server ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }

        const data = await res.json();
        return typeof data?.text === 'string' ? data.text : '';
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`STT server timeout after ${STT_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Речь → текст. Предпочитаем свой STT-сервер (бесплатно); если STT_URL не задан — OpenAI Whisper.
 */
async function runSpeechToText(file: File): Promise<string> {
    if (isSelfHostedSttConfigured()) {
        return await transcribeViaSttServer(file);
    }
    const openai = getOpenAI();
    const result: any = await openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: 'ru',
        response_format: 'text',
    });
    return typeof result === 'string' ? result : (result?.text || '');
}

// ── Async-режим STT (снимает лимит длины звонка) ────────────────────────────────
// Контракт сервера (см. docs/transcription): POST /v1/transcribe (multipart) → 202 { job_id };
// GET /v1/transcribe/{job_id} → { status: queued|processing|done|error, text?, segments?, error? }.
const STT_SUBMIT_TIMEOUT_MS = 120000; // upload файла (быстро)
const STT_POLL_TIMEOUT_MS = 30000;    // лёгкий GET статуса
const STT_STALE_MS = 2 * 60 * 60 * 1000; // если задача «зависла» дольше — пере-submit

function sttHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (STT_TOKEN) h['X-Auth-Token'] = STT_TOKEN;
    return h;
}

/** Ставит задачу в очередь STT, возвращает job_id. client_request_id = id звонка (идемпотентность). */
async function submitToSttServer(file: File, clientRequestId: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STT_SUBMIT_TIMEOUT_MS);
    try {
        const form = new FormData();
        form.append('file', file, 'audio.mp3');
        form.append('language', 'ru');
        form.append('client_request_id', clientRequestId);

        const res = await fetch(`${STT_URL!.replace(/\/+$/, '')}/v1/transcribe`, {
            method: 'POST',
            body: form,
            headers: sttHeaders(),
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`STT submit ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }
        const data = await res.json();
        if (!data?.job_id) throw new Error('STT submit: ответ без job_id');
        return String(data.job_id);
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`STT submit timeout after ${STT_SUBMIT_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

type SttPollResult = { http: number; status?: string; text?: string; segments?: any[]; error?: string; detail?: string };

/** Опрашивает статус задачи STT по job_id. */
async function pollSttServer(jobId: string): Promise<SttPollResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STT_POLL_TIMEOUT_MS);
    try {
        const res = await fetch(`${STT_URL!.replace(/\/+$/, '')}/v1/transcribe/${encodeURIComponent(jobId)}`, {
            headers: sttHeaders(),
            signal: controller.signal,
        });
        if (res.status === 404) return { http: 404 };
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`STT poll ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }
        const data = await res.json();
        return { http: 200, status: data?.status, text: data?.text, segments: data?.segments, error: data?.error, detail: data?.detail };
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`STT poll timeout after ${STT_POLL_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }
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
        await recordAiUsage({ agentId: AiAgent.TRANSCRIPTION, model: response.model, usage: response.usage, purpose: 'amd' });

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
        await recordAiUsage({ agentId: AiAgent.TRANSCRIPTION, model: response.model, usage: response.usage, purpose: 'diarization' });

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
    stt_job_id?: string | null;
    stt_submitted_at?: string | null;
};

async function loadCallForTranscription(callId: string): Promise<TranscriptionCallRow | null> {
    const { data: byCallId } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload, stt_job_id, stt_submitted_at')
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
        .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload, stt_job_id, stt_submitted_at')
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
            .select('telphin_call_id, event_id, transcription_status, transcript, recording_url, duration_sec, raw_payload, stt_job_id, stt_submitted_at')
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

/**
 * Превращает сырой текст в готовую запись: диаризация ролей, AMD, запись в raw_telphin_calls
 * (transcription_status='completed', сброс stt_job_id) и триггер инсайт-агента. Общий финальный
 * шаг для синхронного пути (transcribeCall) и async-поллера (pollSubmittedTranscription).
 */
export async function finalizeTranscript(callId: string, rawTranscription: string): Promise<string> {
    console.log(`[Transcribe] Diarizing ${callId}...`);
    const transcription = await diarizeTranscript(rawTranscription);
    return await writeFinalTranscript(callId, transcription);
}

/**
 * Записывает УЖЕ размеченный транскрипт: AMD, запись в raw_telphin_calls (completed, сброс
 * stt_job_id), триггер инсайта. Общий для текстовой диаризации и детерминированного стерео-пути.
 */
export async function writeFinalTranscript(callId: string, transcription: string): Promise<string> {
    let amd: any = null;
    try {
        amd = await analyzeAnsweringMachine(transcription);
    } catch (e) {
        console.error('[Transcribe] AMD failed, skipping classification:', e);
    }

    const payload: any = {
        transcript: transcription,
        transcription_status: 'completed',
        stt_job_id: null,
    };
    if (amd) {
        payload.is_answering_machine = amd.isAnsweringMachine;
        payload.am_detection_result = { reason: amd.reason, processed_at: new Date().toISOString() };
    }

    const tryUpdate = async (col: string, val: any, p: any) => {
        const { data, error } = await supabase.from('raw_telphin_calls').update(p).eq(col, val).select();
        if (error && (error.code === '42703' || error.message?.includes('column'))) {
            // Старая схема без новых колонок — повторяем без них
            const { is_answering_machine, am_detection_result, stt_job_id, ...fallback } = p;
            return supabase.from('raw_telphin_calls').update(fallback).eq(col, val).select();
        }
        return { data, error };
    };

    let { data, error } = await tryUpdate('telphin_call_id', callId, payload);
    if ((!data || data.length === 0) && /^\d+$/.test(callId)) {
        const secondAttempt = await tryUpdate('event_id', parseInt(callId, 10), payload);
        data = secondAttempt.data;
        error = secondAttempt.error;
    }
    if (error) throw error;
    if (!data || data.length === 0) {
        console.warn(`[Transcribe] Transcript generated but no matching row found for ${callId}`);
    }

    // Триггер инсайт-агента при наличии матча
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
                console.error('[InsightAgent] Post-transcribe trigger failed:', e));
        }
    } catch (e) { }

    return transcription;
}

// ── Детерминированные роли по стерео-каналам ───────────────────────────────────
export type ChannelSegment = { start: number; end?: number; text: string; channel: number };

function textsNearlyIdentical(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const A = norm(a), B = norm(b);
    if (!A || !B) return false;
    if (A === B) return true;
    const wordsA = A.split(' ');
    const wordsB = B.split(' ');
    const setB = new Set(wordsB);
    const union = new Set(wordsA);
    wordsB.forEach(w => union.add(w));
    let inter = 0;
    wordsA.forEach(w => { if (setB.has(w)) inter++; });
    return union.size > 0 && inter / union.size > 0.9;
}

/** Бинарно определяет, какой канал — сотрудник компании (оператор). Каналы уже разделены, решение надёжное. */
async function determineOperatorChannel(text0: string, text1: string): Promise<0 | 1> {
    try {
        const openai = getOpenAI();
        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'Дано два канала записи телефонного разговора. Один канал — СОТРУДНИК компании (оператор/менеджер: представляется компанией, ведёт по скрипту, выставляет счёт/КП, отвечает по заказу). Другой — внешний АБОНЕНТ (клиент). Определи, какой канал — сотрудник компании. Ответ строго JSON: {"operator": 0} или {"operator": 1}.',
                },
                { role: 'user', content: `Канал 0: ${text0.slice(0, 1500)}\n\nКанал 1: ${text1.slice(0, 1500)}` },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        });
        await recordAiUsage({ agentId: AiAgent.TRANSCRIPTION, model: resp.model, usage: resp.usage, purpose: 'channel_detection' });
        const r = JSON.parse(resp.choices[0].message.content || '{}');
        return r.operator === 1 ? 1 : 0;
    } catch (e) {
        console.error('[Channels] operator detect failed, default 0:', e);
        return 0;
    }
}

/**
 * Строит размеченный транскрипт из сегментов двух каналов (роли по каналу, детерминированно).
 * Возвращает null, если каналы непригодны (пусто/один канал/псевдо-стерео) — тогда нужен моно-fallback.
 */
export async function buildTranscriptFromChannels(segments: ChannelSegment[]): Promise<string | null> {
    const segs = (segments || []).filter(s =>
        s && typeof s.text === 'string' && s.text.trim() && typeof s.start === 'number' && (s.channel === 0 || s.channel === 1));
    if (segs.length < 2) return null;

    const t0 = segs.filter(s => s.channel === 0).sort((a, b) => a.start - b.start).map(s => s.text.trim()).join(' ').trim();
    const t1 = segs.filter(s => s.channel === 1).sort((a, b) => a.start - b.start).map(s => s.text.trim()).join(' ').trim();
    if (!t0 || !t1) return null;                 // один канал пуст → не 2-сторонний
    if (textsNearlyIdentical(t0, t1)) return null; // псевдо-стерео (дубль моно) → моно-fallback

    const operatorChannel = await determineOperatorChannel(t0, t1);

    const ordered = segs.slice().sort((a, b) => a.start - b.start);
    const lines: string[] = [];
    let curRole = ''; let buf: string[] = [];
    for (const s of ordered) {
        const role = s.channel === operatorChannel ? 'Менеджер' : 'Клиент';
        const text = s.text.trim();
        if (!text) continue;
        if (role === curRole) buf.push(text);
        else { if (buf.length) lines.push(`${curRole}: ${buf.join(' ')}`); curRole = role; buf = [text]; }
    }
    if (buf.length) lines.push(`${curRole}: ${buf.join(' ')}`);
    return lines.join('\n');
}

/**
 * Финализация стерео-результата: детерминированные роли по каналам → AMD/запись. При непригодных
 * каналах откатывается на обычную текстовую диаризацию (моно-fallback).
 */
export async function finalizeTranscriptFromChannels(callId: string, segments: ChannelSegment[]): Promise<string> {
    const diarized = await buildTranscriptFromChannels(segments);
    if (diarized != null) {
        return await writeFinalTranscript(callId, diarized);
    }
    const plain = (segments || [])
        .filter(s => s && typeof s.text === 'string')
        .slice()
        .sort((a, b) => (a.start || 0) - (b.start || 0))
        .map(s => s.text.trim())
        .filter(Boolean)
        .join(' ');
    return await finalizeTranscript(callId, plain);
}

type SubmitState = 'submitted' | 'already_submitted' | 'already_completed';

/**
 * Async-путь, шаг 1: ставит звонок в очередь STT и сохраняет stt_job_id (status='submitted').
 * НЕ ждёт результат — его заберёт крон-поллер. Идемпотентно по client_request_id на стороне STT.
 */
export async function submitCallTranscription(callId: string, recordingUrl: string): Promise<{ jobId: string | null; state: SubmitState }> {
    let claimedForProcessing = false;
    try {
        const { row, claimed } = await claimCallForTranscription(callId);
        claimedForProcessing = claimed;

        if (!claimed) {
            if (row.transcription_status === 'completed' && row.transcript) {
                return { jobId: null, state: 'already_completed' };
            }
            if (row.transcription_status === 'submitted' && row.stt_job_id) {
                return { jobId: row.stt_job_id, state: 'already_submitted' };
            }
            if (row.transcription_status === 'skipped') throw new Error(`Call ${callId} is marked as skipped`);
            if (row.transcription_status === 'processing') throw new Error(`Call ${callId} is already being transcribed`);
        }

        const sourceRecordingUrl = row.recording_url || recordingUrl;
        if (!sourceRecordingUrl) throw new Error(`Call ${callId} has no recording URL`);

        const internalUrl = await syncRecordingToStorage(callId, sourceRecordingUrl);
        const file = await downloadAudio(internalUrl || sourceRecordingUrl);

        const jobId = await submitToSttServer(file, callId);

        await supabase.from('raw_telphin_calls')
            .update({ stt_job_id: jobId, stt_submitted_at: new Date().toISOString(), transcription_status: 'submitted' })
            .eq('telphin_call_id', callId);

        return { jobId, state: 'submitted' };
    } catch (e: any) {
        if (claimedForProcessing) {
            await supabase.from('raw_telphin_calls').update({ transcription_status: 'failed' }).eq('telphin_call_id', callId);
        }
        throw e;
    }
}

async function resetForResubmit(callId: string) {
    await supabase.from('raw_telphin_calls')
        .update({ transcription_status: 'pending', stt_job_id: null, stt_submitted_at: null })
        .eq('telphin_call_id', callId);
    // Возвращаем джобу транскрибации в очередь, чтобы submit-воркер пере-отправил аудио.
    await supabase.from('system_jobs')
        .update({ status: 'queued', available_at: new Date().toISOString(), last_error: '' })
        .eq('idempotency_key', `call_transcription:${callId}`)
        .eq('job_type', 'call_transcription');
}

export type PollState = 'done' | 'pending' | 'error' | 'resubmit' | 'poll_error';

/**
 * Async-путь, шаг 2: опрашивает STT по сохранённому job_id и финализирует при готовности.
 * Вызывается крон-поллером для строк transcription_status='submitted'.
 */
export async function pollSubmittedTranscription(row: { telphin_call_id: string; stt_job_id: string; stt_submitted_at?: string | null }): Promise<PollState> {
    const callId = row.telphin_call_id;

    let res: SttPollResult;
    try {
        res = await pollSttServer(row.stt_job_id);
    } catch (e: any) {
        console.error(`[TranscribePoll] poll failed for ${callId}:`, e?.message);
        return 'poll_error';
    }

    if (res.http === 404) {
        await resetForResubmit(callId);
        return 'resubmit';
    }

    if (res.status === 'done') {
        await finalizeTranscript(callId, res.text || '');
        return 'done';
    }

    if (res.status === 'error') {
        await supabase.from('raw_telphin_calls').update({
            transcription_status: 'failed',
            stt_job_id: null,
            am_detection_result: { reason: `STT error: ${[res.error, res.detail].filter(Boolean).join(' ')}`.trim(), processed_at: new Date().toISOString() },
        }).eq('telphin_call_id', callId);
        return 'error';
    }

    // queued/processing — проверяем «зависание»
    if (row.stt_submitted_at && Date.now() - new Date(row.stt_submitted_at).getTime() > STT_STALE_MS) {
        await resetForResubmit(callId);
        return 'resubmit';
    }
    return 'pending';
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

        // 2. Transcribe (свой STT-сервер если задан STT_URL, иначе OpenAI Whisper)
        const rawTranscription = await runSpeechToText(file);

        // 3. Диаризация + AMD + запись в БД + триггер инсайта (общий финальный шаг)
        return await finalizeTranscript(callId, rawTranscription);

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
