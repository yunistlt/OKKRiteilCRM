'use client';

import { useEffect, useState } from 'react';

// ЗАКОН «только человеческий язык»: коды RetailCRM (тип заказа, магазин, способ
// оформления, значения пользовательских справочников, тип контрагента…) в UI
// показываем русским именем из синканутого каталога (/api/dictionaries), не кодом.

type Item = { entity_type: string; dictionary_code: string | null; item_code: string; item_name: string };
type Field = { entity: string; code: string; name: string; dictionary: string };

type Option = { value: string; label: string };

type Catalog = {
    /** entity_type|dictionary_code|item_code → item_name */
    names: Record<string, string>;
    /** код пользовательского поля → код справочника */
    fieldDictionary: Record<string, string>;
    /**
     * Списки значений: ими заполняются выпадающие списки в карточке заказа.
     * Ключ тот же, что у названий, но без кода значения.
     */
    lists: Record<string, Option[]>;
};

const EMPTY: Catalog = { names: {}, fieldDictionary: {}, lists: {} };
let cache: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;

const key = (entity: string, dictionary: string | null, code: string) => `${entity}|${dictionary ?? ''}|${code}`;

async function loadCatalog(): Promise<Catalog> {
    if (cache) return cache;
    if (inflight) return inflight;
    inflight = fetch('/api/dictionaries')
        .then((r) => (r.ok ? r.json() : { items: [], fields: [] }))
        .then((data: { items: Item[]; fields: Field[] }) => {
            const names: Record<string, string> = {};
            const lists: Record<string, Option[]> = {};
            for (const it of data.items ?? []) {
                names[key(it.entity_type, it.dictionary_code, it.item_code)] = it.item_name;
                const listKey = `${it.entity_type}|${it.dictionary_code ?? ''}`;
                (lists[listKey] ||= []).push({ value: it.item_code, label: it.item_name || it.item_code });
            }
            for (const listKey of Object.keys(lists)) {
                lists[listKey].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
            }
            const fieldDictionary: Record<string, string> = {};
            for (const f of data.fields ?? []) fieldDictionary[f.code] = f.dictionary;
            cache = { names, fieldDictionary, lists };
            return cache;
        })
        .catch(() => EMPTY)
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

// Последний резерв, если кода нет в каталоге (устаревший/удалённый код).
function humanize(code: string): string {
    return code
        .replace(/[-_]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export type DictionaryEntity =
    | 'orderType'
    | 'orderMethod'
    | 'site'
    | 'store'
    | 'paymentType'
    | 'paymentStatus'
    | 'deliveryType'
    | 'status'
    | 'productStatus'
    | 'contragentType'
    | 'userGroup';

export type DictionaryResolver = {
    /** Системное перечисление: resolve('site', 'zmktlt-ru') → 'ООО "ЗМК" (Т-банк)'. */
    resolve: (entity: DictionaryEntity, code: string | null | undefined) => string;
    /** Значение пользовательского поля по коду поля: field('typ_customer_margin', 'trebuetsya-utochnit') → 'Требуется уточнить'. */
    field: (fieldCode: string, value: string | null | undefined) => string;
    /** Значение справочника по коду справочника. */
    dictionary: (dictionaryCode: string, value: string | null | undefined) => string;
    /** Список значений системного перечисления — для выпадающего списка. */
    enumOptions: (entity: DictionaryEntity) => Option[];
    /** Список значений пользовательского поля по его коду. */
    fieldOptions: (fieldCode: string) => Option[];
    ready: boolean;
};

export function useDictionaryNames(): DictionaryResolver {
    const [catalog, setCatalog] = useState<Catalog>(cache ?? EMPTY);
    const [ready, setReady] = useState(Boolean(cache));

    useEffect(() => {
        let alive = true;
        loadCatalog().then((c) => {
            if (!alive) return;
            setCatalog(c);
            setReady(true);
        });
        return () => {
            alive = false;
        };
    }, []);

    const dictionary = (dictionaryCode: string, value: string | null | undefined) => {
        if (value == null || value === '') return '';
        const v = String(value);
        return catalog.names[key('customField', dictionaryCode, v)] || humanize(v);
    };

    return {
        ready,
        resolve: (entity, code) => {
            if (code == null || code === '') return '';
            const c = String(code);
            /**
             * `own-crm` — код несуществующей витрины: так помечались первые свои
             * заказы, пока юрлицо им не выбирали. Показывать «Own Crm» нельзя —
             * в интерфейсе кодов быть не должно (закон проекта), да и магазина
             * такого нет. Пусто честнее: менеджер выберет юрлицо сам.
             */
            if (entity === 'site' && c === 'own-crm') return '';
            return catalog.names[key(entity, null, c)] || humanize(c);
        },
        field: (fieldCode, value) => {
            if (value == null || value === '') return '';
            const dict = catalog.fieldDictionary[fieldCode];
            return dict ? dictionary(dict, String(value)) : String(value);
        },
        dictionary,
        enumOptions: (entity) => catalog.lists[`${entity}|`] ?? [],
        fieldOptions: (fieldCode) => {
            const dict = catalog.fieldDictionary[fieldCode];
            return dict ? (catalog.lists[`customField|${dict}`] ?? []) : [];
        },
    };
}
