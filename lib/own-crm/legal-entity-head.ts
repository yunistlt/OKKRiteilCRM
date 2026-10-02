/**
 * Кто подписывает документы наших юрлиц — из ЕГРЮЛ, а не со слов.
 *
 * Решение владельца 02.10.2026: «надо взять генерального директора из выписок
 * ЕГРЮЛ». Руководителя по ИНН отдаёт Dadata (бесплатный тариф подсказок, см.
 * `lib/sales-rop/dadata.ts`), там же его должность — «ДИРЕКТОР»,
 * «ГЕНЕРАЛЬНЫЙ ДИРЕКТОР», «УПРАВЛЯЮЩИЙ-ИП». Регистр приводим к человеческому:
 * в счёте не должно быть капса (закон «интерфейс — человеческий язык»).
 *
 * Результат кладём в `legal_entities.signer_name` / `signer_title` — оттуда их
 * берёт счёт (`lib/own-crm/documents.ts`).
 */
import { supabase } from '@/utils/supabase';
import { companyByInn, isDadataConfigured } from '@/lib/sales-rop/dadata';

/**
 * Страна, регион и город для нижней дуги печати: «Россия, Республика
 * Татарстан, город Елабуга». Берём из ЕГРЮЛ, а не из адреса продавца — у ЗВТО
 * это Татарстан, а банковский адрес ведёт в Самарскую область.
 */
export function sealPlaceFrom(region: string | null | undefined, city: string | null | undefined): string | null {
    /**
     * Сокращения ЕГРЮЛ разворачиваем вручную по словам: в JS `\b` и `\w` с
     * кириллицей не работают (своя грабля, закон про регулярки), поэтому
     * границу слова не ищем — разбираем строку на слова и заменяем целиком.
     */
    const WORDS: Record<string, string> = {
        'респ': 'Республика',
        'респ.': 'Республика',
        'обл': 'область',
        'обл.': 'область',
        'кр': 'край',
        'кр.': 'край',
        'г': 'город',
        'г.': 'город',
        'тер': 'территория',
        'тер.': 'территория',
        'с': 'село',
        'с.': 'село',
        'пгт': 'посёлок',
        'пгт.': 'посёлок',
        'д': 'деревня',
        'д.': 'деревня',
    };

    const full = (value: string) => value
        .trim()
        .split(/\s+/)
        .map((word) => WORDS[word.toLowerCase()] ?? word)
        .join(' ')
        .trim();

    const parts = ['Россия'];
    if (region?.trim()) parts.push(full(region));
    if (city?.trim() && !String(region ?? '').toLowerCase().includes(String(city).toLowerCase())) {
        parts.push(full(city));
    }
    return parts.length > 1 ? parts.join(', ') : null;
}

export type HeadUpdate = {
    inn: string;
    entity: string;
    /** Что записали; пусто — ЕГРЮЛ руководителя не назвал. */
    name: string | null;
    title: string | null;
    note: string | null;
};

/**
 * «ГЕНЕРАЛЬНЫЙ ДИРЕКТОР» → «Генеральный директор», «УПРАВЛЯЮЩИЙ-ИП» →
 * «Управляющий-ИП»: аббревиатуры остаются заглавными, остальное — обычным
 * текстом.
 */
const ABBREVIATIONS = new Set(['ип', 'ооо', 'ао', 'нао', 'зао', 'пао', 'ук', 'рф']);

export function humanTitle(value: string | null | undefined): string | null {
    const text = String(value ?? '').trim();
    if (!text) return null;

    let first = true;
    return text
        .toLowerCase()
        .split(/([\s-]+)/)
        .map((part) => {
            if (/^[\s-]+$/.test(part) || !part) return part;
            if (ABBREVIATIONS.has(part)) return part.toUpperCase();
            if (first) {
                first = false;
                return part.charAt(0).toUpperCase() + part.slice(1);
            }
            return part;
        })
        .join('');
}

/**
 * Обновить подписантов всех активных юрлиц. Возвращает, что получилось по
 * каждому — число должно раскладываться, поэтому отдаём не счётчик, а список.
 */
export async function refreshSignersFromEgrul(): Promise<HeadUpdate[]> {
    if (!isDadataConfigured()) {
        throw new Error('Нет ключа ЕГРЮЛ (DADATA_API_KEY) — руководителей брать неоткуда');
    }

    const { data, error } = await supabase
        .from('legal_entities')
        .select('id, inn, short_name, kind, signer_name, signer_title')
        .eq('active', true)
        .order('sort_order');
    if (error) throw new Error(error.message);

    const results: HeadUpdate[] = [];

    for (const row of ((data ?? []) as any[])) {
        const info = await companyByInn(String(row.inn));

        /**
         * У ИП подписант — сам предприниматель (указание владельца
         * 02.10.2026). В ЕГРИП руководителя нет и быть не может, но ФИО есть в
         * названии: «Индивидуальный предприниматель Теренков Андрей
         * Анатольевич».
         */
        const soleTrader = !info?.managerName && String(info?.fullName ?? '').toLowerCase().includes('индивидуальный предприниматель');
        const name = soleTrader
            ? String(info?.fullName ?? '').replace(/^индивидуальный предприниматель\s*/i, '').trim() || null
            : info?.managerName?.trim() || null;
        const title = soleTrader ? 'Индивидуальный предприниматель' : humanTitle(info?.managerTitle);

        const place = sealPlaceFrom(info?.region, info?.city);

        if (info?.fullName || place) {
            await supabase
                .from('legal_entities')
                .update({
                    ...(info?.fullName ? { full_name: info.fullName } : {}),
                    ...(place ? { seal_place: place } : {}),
                })
                .eq('id', row.id);
        }

        if (!name) {
            results.push({
                inn: String(row.inn),
                entity: row.short_name,
                name: null,
                title: null,
                note: info
                    ? 'ЕГРЮЛ не называет руководителя — впишите подписанта руками'
                    : 'Не удалось получить данные ЕГРЮЛ по этому ИНН',
            });
            continue;
        }

        const { error: saveError } = await supabase
            .from('legal_entities')
            .update({
                signer_name: name,
                signer_title: title,
                ...(info?.fullName ? { full_name: info.fullName } : {}),
                ...(place ? { seal_place: place } : {}),
            })
            .eq('id', row.id);
        if (saveError) throw new Error(`${row.short_name}: ${saveError.message}`);

        results.push({
            inn: String(row.inn),
            entity: row.short_name,
            name,
            title,
            note: info?.status && info.status !== 'действующая' ? `Внимание: по ЕГРЮЛ компания ${info.status}` : null,
        });
    }

    return results;
}
