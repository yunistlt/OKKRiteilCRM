/**
 * Чем кончился звонок — по данным самого Телфина, без догадок по длительности.
 *
 * Зачем. В очереди на расшифровку висело 6 978 звонков, из них 6 464 без записи: их
 * нельзя расшифровать никогда, но статус у них был `pending` — «ждёт расшифровки».
 * Счётчик застрявших рос вечно, ночной разбор хвоста каждый раз перебирал тысячи
 * безнадёжных строк, а тревога «6965 застряло» перестала что-либо значить.
 *
 * Почему не по длительности. `duration_sec` у нас считается от начала набора до отбоя,
 * поэтому недозвон, где человек 33 секунды слушал гудки, выглядит как разговор. И наоборот —
 * за 30 секунд с клиентом вполне можно поговорить, так что короткие отбрасывать нельзя.
 * Длительность вообще не признак.
 *
 * Признак даёт сам Телфин. В `raw_payload.cdr` лежат «ноги» звонка, у каждой есть
 * `result` (`answered` / `failed` / `busy` / `not answered`) и `record_uuid`/`storage_url`.
 * Проверка на 30 днях: где соединение состоялось и есть запись — 1525 звонков, из них
 * расшифровано 1483. Где соединения не было — 554, где соединение было только с голосовым
 * меню (добавочные `*002`, `*099`) — 96. Ни одного потерянного разговора с менеджером:
 * при соединении с живым человеком запись есть всегда.
 */

/** Статусы, означающие «расшифровать нечего» — их ставит этот модуль. */
export const NO_ANSWER_STATUS = 'no_answer';
export const NO_RECORDING_STATUS = 'no_recording';

/** Статусы, которые можно переписать: работа по ним ещё не начиналась. */
const REWRITABLE_STATUSES = new Set([null, '', 'pending', 'ready_for_transcription']);

type CallLeg = {
    result?: string | null;
    record_uuid?: string | null;
    storage_url?: string | null;
};

function legs(rawPayload: unknown): CallLeg[] {
    if (!rawPayload || typeof rawPayload !== 'object') return [];
    const cdr = (rawPayload as Record<string, any>).cdr;
    return Array.isArray(cdr) ? (cdr as CallLeg[]) : [];
}

/** Состоялось ли соединение: хоть одна нога звонка была отвечена. */
export function didConnect(rawPayload: unknown): boolean {
    return legs(rawPayload).some((leg) => String(leg?.result || '').toLowerCase() === 'answered');
}

/**
 * Есть ли запись разговора. Смотрим и на готовую ссылку, и на ноги звонка: ссылка
 * подтягивается отдельным шагом и на момент импорта её может ещё не быть.
 */
export function hasRecording(rawPayload: unknown, recordingUrl?: string | null): boolean {
    if (recordingUrl) return true;
    return legs(rawPayload).some((leg) => Boolean(leg?.record_uuid || leg?.storage_url));
}

/**
 * Какой статус расшифровки честен для этого звонка.
 *
 * Возвращает `null`, когда трогать нечего: расшифровка уже идёт или сделана, либо запись
 * есть и звонок законно ждёт своей очереди. Ничего не «чинит» задним числом — только
 * заменяет вечное `pending` на причину, по которой расшифровки не будет.
 */
export function resolveTranscriptionStatus(params: {
    rawPayload: unknown;
    recordingUrl?: string | null;
    currentStatus?: string | null;
    hasTranscript?: boolean;
}): typeof NO_ANSWER_STATUS | typeof NO_RECORDING_STATUS | null {
    if (params.hasTranscript) return null;
    if (!REWRITABLE_STATUSES.has(params.currentStatus ?? null)) return null;
    if (hasRecording(params.rawPayload, params.recordingUrl)) return null;

    return didConnect(params.rawPayload) ? NO_RECORDING_STATUS : NO_ANSWER_STATUS;
}

/** Русские подписи для интерфейса: кодов статусов человек видеть не должен. */
export const TRANSCRIPTION_STATUS_LABELS: Record<string, string> = {
    pending: 'Ждёт расшифровки',
    ready_for_transcription: 'Готов к расшифровке',
    processing: 'Расшифровывается',
    submitted: 'Отправлен на расшифровку',
    completed: 'Расшифрован',
    failed: 'Ошибка расшифровки',
    skipped: 'Пропущен',
    expired: 'Запись устарела',
    [NO_ANSWER_STATUS]: 'Не дозвонились',
    [NO_RECORDING_STATUS]: 'Без записи',
};

export function transcriptionStatusLabel(status?: string | null): string {
    if (!status) return 'Ждёт расшифровки';
    return TRANSCRIPTION_STATUS_LABELS[status] || status;
}
