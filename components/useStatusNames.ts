'use client';

import { useEffect, useState } from 'react';

// ЗАКОН «только человеческий язык»: в UI показываем русское имя статуса заказа,
// а не технический код RetailCRM. Имена тянем из каталога статусов (таблица statuses),
// который синкается из CRM — ничего не выдумываем и не хардкодим.

type StatusMap = Record<string, string>;

let cache: StatusMap | null = null;
let inflight: Promise<StatusMap> | null = null;

async function loadStatusNames(): Promise<StatusMap> {
    if (cache) return cache;
    if (inflight) return inflight;
    inflight = fetch('/api/statuses?scope=all')
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: Array<{ code: string; name: string }>) => {
            const map: StatusMap = {};
            for (const row of rows ?? []) {
                if (row?.code && row?.name) map[row.code] = row.name;
            }
            cache = map;
            return map;
        })
        .catch(() => ({}))
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

// Гуманизация кода — последний резерв, если код отсутствует в каталоге.
function humanize(code: string): string {
    return code
        .replace(/[-_]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Хук: возвращает функцию resolve(code) → русское имя статуса заказа. */
export function useStatusNames(): (code: string | null | undefined) => string {
    const [map, setMap] = useState<StatusMap>(cache ?? {});

    useEffect(() => {
        let alive = true;
        loadStatusNames().then((m) => {
            if (alive) setMap(m);
        });
        return () => {
            alive = false;
        };
    }, []);

    return (code) => {
        if (!code) return '';
        return map[code] || humanize(code);
    };
}
