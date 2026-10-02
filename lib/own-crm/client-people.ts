/**
 * Данные человека (физлица) правятся в ОКК.
 *
 * Решение владельца 02.10.2026: ФИО, телефоны и почту контактного лица
 * исправляет менеджер у нас, в RetailCRM правка не уезжает. Поэтому здесь два
 * дела: записать правку в `customers` и поставить метку `okk_edited_at` — по
 * ней синхронизация контактов (`lib/retailcrm/customers-sync.ts`) перестаёт
 * перезаписывать личные поля этой строки данными из CRM.
 *
 * Имена колонок — как у RetailCRM (`firstName`, `lastName`), потому что
 * таблица её зеркало; в кавычках, иначе Postgres опустит регистр.
 */
import { supabase } from '@/utils/supabase';

export type PersonEdit = {
    lastName?: string | null;
    firstName?: string | null;
    patronymic?: string | null;
    email?: string | null;
    phones?: string[];
};

export type Person = {
    id: number;
    lastName: string | null;
    firstName: string | null;
    patronymic: string | null;
    email: string | null;
    phones: string[];
    editedAt: string | null;
    editedBy: string | null;
};

const PERSON_COLUMNS = '"id","firstName","lastName","patronymic","email","phones","okk_edited_at","okk_edited_by"';

/** Телефон в виде, в котором его хранит CRM: только цифры и плюс. */
export function normalizePhone(value: unknown): string {
    return String(value ?? '').replace(/[^\d+]/g, '');
}

function toPerson(row: any): Person {
    return {
        id: Number(row.id),
        lastName: row.lastName ?? null,
        firstName: row.firstName ?? null,
        patronymic: row.patronymic ?? null,
        email: row.email ?? null,
        phones: Array.isArray(row.phones) ? row.phones.map(String) : [],
        editedAt: row.okk_edited_at ?? null,
        editedBy: row.okk_edited_by ?? null,
    };
}

/** Один человек. */
export async function loadPerson(id: number | string): Promise<Person | null> {
    const { data } = await supabase
        .from('customers')
        .select(PERSON_COLUMNS)
        .eq('id', id)
        .maybeSingle();

    return data ? toPerson(data) : null;
}

/**
 * Сохранить правку человека. Пустые строки не стираем в null без надобности:
 * что менеджер оставил пустым, то и будет пустым, но поля, которых нет в
 * правке, не трогаем вовсе.
 */
export async function savePerson(
    id: number | string,
    edit: PersonEdit,
    actor: string | null,
): Promise<Person> {
    const patch: Record<string, unknown> = {
        okk_edited_at: new Date().toISOString(),
        okk_edited_by: actor,
        updated_at: new Date().toISOString(),
    };

    if (edit.lastName !== undefined) patch.lastName = edit.lastName?.trim() || null;
    if (edit.firstName !== undefined) patch.firstName = edit.firstName?.trim() || null;
    if (edit.patronymic !== undefined) patch.patronymic = edit.patronymic?.trim() || null;
    if (edit.email !== undefined) patch.email = edit.email?.trim() || null;
    if (edit.phones !== undefined) {
        patch.phones = edit.phones.map(normalizePhone).filter(Boolean);
    }

    const { error } = await supabase.from('customers').update(patch).eq('id', id);
    if (error) throw new Error(`Не удалось сохранить данные человека: ${error.message}`);

    const person = await loadPerson(id);
    if (!person) throw new Error('Человек не найден');
    return person;
}

/**
 * Какие из строк правили у нас. Нужно синхронизации: её данные для таких
 * людей устарели — в CRM правку не отправляли.
 */
export async function personsEditedInOkk(ids: Array<number | string>): Promise<Set<number>> {
    const list = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (!list.length) return new Set();

    const { data } = await supabase
        .from('customers')
        .select('id')
        .in('id', list)
        .not('okk_edited_at', 'is', null);

    return new Set(((data ?? []) as any[]).map((row) => Number(row.id)));
}
