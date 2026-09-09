import { supabase } from '@/utils/supabase';
import { accessToken } from '@/lib/shtab/google/oauth';
import { RHYTHM, firstSlot, renderAgenda, rhythmUid } from '@/lib/shtab/google/rhythm';
import type { RhythmCode } from '@/lib/shtab/google/rhythm';

// Работа с календарём: свой календарь «Ритм Штаба», занятость, события ритма.
//
// Всё пишется в календарь, который Штаб создал сам. Право calendar.app.created
// другого и не позволяет — и это сделано намеренно: ошибка в этом файле не может
// тронуть личные события владельца.

const API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_TITLE = 'Ритм Штаба';
const TIME_ZONE = 'Europe/Samara'; // Тольятти

async function api<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
    const { token, ...rest } = init;
    const res = await fetch(`${API}${path}`, {
        ...rest,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const reason = (data as any)?.error?.message || `ответ ${res.status}`;
        throw new Error(`Google Calendar: ${reason}`);
    }
    return data as T;
}

/** Календарь Штаба. Создаётся один раз, дальше берётся из базы. */
export async function ensureCalendar(): Promise<{ token: string; calendarId: string }> {
    const { token, calendarId } = await accessToken();
    if (calendarId) return { token, calendarId };

    const created = await api<{ id: string }>('/calendars', {
        token,
        method: 'POST',
        body: JSON.stringify({ summary: CALENDAR_TITLE, timeZone: TIME_ZONE }),
    });

    const { error } = await supabase
        .from('shtab_google_token')
        .update({ calendar_id: created.id, updated_at: new Date().toISOString() })
        .eq('id', 1);
    if (error) throw new Error(error.message);

    return { token, calendarId: created.id };
}

export type BusySlot = { start: string; end: string };

/**
 * Занятость владельца за период.
 *
 * Используется ОДИН раз — при подборе слотов на подключении. Дальше встречи не
 * двигаются: в этом и смысл ритма. Если позже возникнет наложение, мы сообщим о
 * нём, а решит владелец.
 */
export async function busy(timeMin: string, timeMax: string): Promise<BusySlot[]> {
    const { token } = await accessToken();
    const data = await api<{ calendars: Record<string, { busy?: BusySlot[]; errors?: unknown[] }> }>('/freeBusy', {
        token,
        method: 'POST',
        body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
    });
    return data.calendars?.primary?.busy ?? [];
}

/** Пересекается ли предполагаемая встреча с занятым временем. */
export function conflicts(startIso: string, minutes: number, slots: readonly BusySlot[]): BusySlot[] {
    const start = Date.parse(startIso);
    const end = start + minutes * 60_000;
    return slots.filter((s) => {
        const bStart = Date.parse(s.start);
        const bEnd = Date.parse(s.end);
        return Number.isFinite(bStart) && Number.isFinite(bEnd) && bStart < end && start < bEnd;
    });
}

export type RhythmEventResult = { code: RhythmCode; action: 'created' | 'updated'; htmlLink?: string };

/**
 * Заводит или обновляет события ритма.
 *
 * Идентификатор события устойчив (rhythmUid), поэтому повторный вызов не
 * задваивает встречи, а обновляет повестку у уже существующих. Время начала при
 * обновлении НЕ трогается: слот выбран один раз и дальше принадлежит владельцу.
 */
export async function upsertRhythm(opts: {
    weekStartIso: string;
    hours: Partial<Record<RhythmCode, number>>;
    programLines: readonly string[];
    attendees?: string[];
}): Promise<RhythmEventResult[]> {
    const { token, calendarId } = await ensureCalendar();
    const out: RhythmEventResult[] = [];

    for (const meeting of RHYTHM) {
        const uid = rhythmUid(meeting.code, calendarId);
        const description = renderAgenda(meeting, opts.programLines);

        const existing = await api<{ items?: Array<{ id: string; start?: { dateTime?: string } }> }>(
            `/calendars/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(uid)}&showDeleted=false&maxResults=1`,
            { token, method: 'GET' },
        );
        const found = existing.items?.[0];

        if (found) {
            // Только повестка. Время и правило повторения остаются как есть —
            // встречу мог подвинуть владелец, и возвращать её назад нельзя.
            const updated = await api<{ htmlLink?: string }>(
                `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(found.id)}`,
                { token, method: 'PATCH', body: JSON.stringify({ description }) },
            );
            out.push({ code: meeting.code, action: 'updated', htmlLink: updated.htmlLink });
            continue;
        }

        const hour = opts.hours[meeting.code] ?? 8;
        const start = firstSlot(meeting.code, opts.weekStartIso, hour);
        const end = new Date(Date.parse(start) + meeting.minutes * 60_000).toISOString();

        const created = await api<{ htmlLink?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
            token,
            method: 'POST',
            body: JSON.stringify({
                iCalUID: uid,
                summary: meeting.title,
                description,
                start: { dateTime: start, timeZone: TIME_ZONE },
                end: { dateTime: end, timeZone: TIME_ZONE },
                recurrence: [meeting.rrule],
                attendees: (opts.attendees ?? []).map((email) => ({ email })),
                reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
            }),
        });
        out.push({ code: meeting.code, action: 'created', htmlLink: created.htmlLink });
    }

    return out;
}
