'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Выбор компаний в группу: окно со списком и поиском.
 *
 * Решение владельца 06.10.2026: «они сами ручками выберут те компании,
 * которые относятся к этой группе компаний, поиском из списка, из
 * всплывающего окна со списком компаний». Никаких подсказок и советов —
 * система не угадывает, что фирмы связаны, это знает только менеджер.
 *
 * Список — тот же реестр клиентов, что и в разделе «Клиенты»: поиск по
 * названию, ИНН, телефону и почте.
 */
export interface PickedCompany {
    id: number;
    name: string;
    inn: string | null;
    orders: number;
}

export default function CompanyPickerModal({
    excludeIds,
    onClose,
    onPick,
}: {
    /** Кого не показывать: текущая карточка и те, кто уже в группе. */
    excludeIds: number[];
    onClose: () => void;
    onPick: (ids: number[]) => Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [rows, setRows] = useState<PickedCompany[]>([]);
    const [chosen, setChosen] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/clients?q=${encodeURIComponent(query.trim())}&pageSize=50&sort=total_summ`);
                const payload = await res.json();
                const list: PickedCompany[] = (payload.clients || payload.items || payload.rows || []).map((c: any) => ({
                    id: Number(c.id),
                    name: c.company_name || c.contact_name || `Карточка №${c.id}`,
                    inn: c.inn ?? null,
                    orders: Number(c.orders_count ?? 0),
                }));
                setRows(list.filter((c) => !excludeIds.includes(c.id)));
            } finally {
                setLoading(false);
            }
        }, 250);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [query, excludeIds]);

    const toggle = (id: number) =>
        setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const save = async () => {
        if (!chosen.length) return;
        setSaving(true);
        try {
            await onPick(chosen);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/50 p-6" onClick={onClose}>
            <div
                className="flex max-h-[80vh] w-full max-w-2xl flex-col bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                    <h3 className="text-sm font-semibold text-gray-900">Добавить компании в группу</h3>
                    <button type="button" onClick={onClose} className="px-1 text-xl leading-none text-gray-400 hover:text-gray-900">
                        ×
                    </button>
                </div>

                <div className="border-b border-gray-200 px-4 py-2">
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Название, ИНН, телефон или почта"
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm"
                    />
                </div>

                <div className="flex-1 overflow-auto">
                    {loading && <div className="px-4 py-3 text-xs text-gray-500">Ищем…</div>}
                    {!loading && rows.length === 0 && (
                        <div className="px-4 py-3 text-xs text-gray-500">Ничего не нашли.</div>
                    )}
                    {rows.map((c) => (
                        <label
                            key={c.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-2 hover:bg-amber-50"
                        >
                            <input
                                type="checkbox"
                                checked={chosen.includes(c.id)}
                                onChange={() => toggle(c.id)}
                                className="h-4 w-4 border-gray-300 text-blue-600"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-gray-900">{c.name}</span>
                                <span className="block text-[11px] text-gray-500">
                                    {c.inn ? `ИНН ${c.inn} · ` : ''}{c.orders} заказов
                                </span>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
                    <span className="text-xs text-gray-500">
                        {chosen.length ? `Выбрано: ${chosen.length}` : 'Отметьте компании этой группы'}
                    </span>
                    <button
                        type="button"
                        disabled={!chosen.length || saving}
                        onClick={save}
                        className="border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100 disabled:text-gray-400"
                    >
                        {saving ? 'Добавляем…' : 'Добавить в группу'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
