import { supabase } from '@/utils/supabase';

/**
 * Отпуска и отсутствия — один справочник на всю систему.
 *
 * Ведётся в «Катерине» (таблица `email_intake_absences`, экран «Отпуска»),
 * оттуда его читают распределение писем, зарплата и недельный обзор нагрузки.
 * Утренний план не читал его вовсе: 11.11.2026 выяснилось, что Гордеева уходит
 * в отпуск с 12.11 по 26.11, а план на 15 задач ей всё равно уйдёт — и так
 * каждый день две недели.
 *
 * Второй справочник заводить нельзя: отпуск один, и разойдутся они в первый же
 * раз, когда дату поправят в одном месте.
 */

export type Absence = {
    managerId: number;
    /** Включительно, ГГГГ-ММ-ДД. */
    from: string;
    to: string;
    note: string | null;
};

export async function loadAbsences(): Promise<Absence[]> {
    const { data, error } = await supabase
        .from('email_intake_absences')
        .select('manager_id, start_date, end_date, note');
    if (error) return [];
    return ((data ?? []) as any[])
        .map((a) => ({
            managerId: Number(a.manager_id),
            from: String(a.start_date).slice(0, 10),
            to: String(a.end_date).slice(0, 10),
            note: a.note ?? null,
        }))
        .filter((a) => Number.isFinite(a.managerId) && a.from && a.to);
}

/** Отсутствует ли человек в этот день. */
export function absenceOn(absences: Absence[], managerId: number | null, date: string): Absence | null {
    if (managerId === null) return null;
    return absences.find((a) => a.managerId === managerId && a.from <= date && a.to >= date) ?? null;
}

/** Ближайшее будущее отсутствие: по нему идёт разговор «успеть до отпуска». */
export function nextAbsence(absences: Absence[], managerId: number | null, date: string): Absence | null {
    if (managerId === null) return null;
    return (
        absences
            .filter((a) => a.managerId === managerId && a.from > date)
            .sort((x, y) => x.from.localeCompare(y.from))[0] ?? null
    );
}

/** Сколько дней осталось до даты. Отрицательных не бывает: прошлое — это ноль. */
export function daysUntil(date: string, from: string): number {
    const ms = new Date(`${date}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
    return Math.max(0, Math.round(ms / 86_400_000));
}

/** Кто из отдела отсутствует сегодня — чтобы РОП знал, чьи клиенты без присмотра. */
export function absentToday(absences: Absence[], date: string): Absence[] {
    return absences.filter((a) => a.from <= date && a.to >= date);
}
