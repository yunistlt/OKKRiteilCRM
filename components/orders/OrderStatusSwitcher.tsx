'use client';

import { useCallback, useEffect, useState } from 'react';

interface Option {
    code: string;
    name: string;
    color: string | null;
    groupName: string;
}

interface OrderStatusSwitcherProps {
    orderId: number | string;
    currentLabel?: string | null;
    onChanged?: (code: string) => void;
}

/**
 * Смена статуса заказа из карточки. Показываем только те статусы, в которые разрешён
 * переход по нашей матрице, сгруппированные и окрашенные — как в RetailCRM.
 */
export default function OrderStatusSwitcher({ orderId, currentLabel, onChanged }: OrderStatusSwitcherProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{
        writeEnabled: boolean;
        currentName: string | null;
        known: boolean;
        transitionsConfigured: boolean;
        options: Option[];
    } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/status`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось получить переходы');
            setData(json);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось получить переходы');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => { if (open && !data) load(); }, [open, data, load]);

    const change = async (code: string) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: code }),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(
                    json.error === 'transition_not_allowed' ? 'Такой переход запрещён настройками статусов'
                    : json.error === 'status_not_mapped' ? 'Статус не сопоставлен с нашим справочником'
                    : json.error === 'crm_rejected' ? `RetailCRM отклонил смену статуса: ${json.details || 'без пояснения'}`
                    : 'Не удалось сменить статус'
                );
            }
            setOpen(false);
            setData(null);
            onChanged?.(code);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сменить статус');
        } finally {
            setSaving(false);
        }
    };

    const grouped = (data?.options || []).reduce<Record<string, Option[]>>((acc, o) => {
        (acc[o.groupName] ||= []).push(o);
        return acc;
    }, {});

    return (
        <div className="relative inline-block">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:border-blue-500"
            >
                <span>{currentLabel || 'Статус'}</span>
                <span className="text-gray-400">▾</span>
            </button>

            {open && (
                <div className="absolute left-0 z-50 mt-1 w-80 rounded-md border border-gray-200 bg-white shadow-lg">
                    {loading && <p className="px-3 py-3 text-sm text-gray-500">Загружаем переходы…</p>}

                    {!loading && data && !data.writeEnabled && (
                        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
                            Отправка изменений в RetailCRM пока отключена — сначала достраиваем свой функционал.
                            Список ниже показывает разрешённые переходы, но смена не применится.
                        </p>
                    )}

                    {!loading && data && !data.transitionsConfigured && (
                        <p className="px-3 py-3 text-sm text-gray-600">
                            Переходы статусов ещё не настроены. Задайте их на экране «Статусы и переходы».
                        </p>
                    )}

                    {!loading && data?.transitionsConfigured && !data.known && (
                        <p className="px-3 py-3 text-sm text-gray-600">
                            Текущий статус не сопоставлен с нашим справочником, поэтому разрешённых переходов нет.
                        </p>
                    )}

                    {!loading && data?.known && data.options.length === 0 && (
                        <p className="px-3 py-3 text-sm text-gray-600">
                            Из этого статуса переходы не разрешены.
                        </p>
                    )}

                    {Object.entries(grouped).map(([groupName, options]) => (
                        <div key={groupName}>
                            <p className="bg-gray-50 px-3 py-1 text-xs text-gray-500">{groupName}</p>
                            {options.map((o) => (
                                <button
                                    key={o.code}
                                    onClick={() => change(o.code)}
                                    disabled={saving}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-blue-50 disabled:text-gray-400"
                                >
                                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: o.color || '#e5e7eb' }} />
                                    <span className="truncate">{o.name}</span>
                                </button>
                            ))}
                        </div>
                    ))}

                    {error && <p className="border-t border-gray-200 px-3 py-2 text-xs text-red-700">{error}</p>}
                    {saving && <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">Меняем статус…</p>}
                </div>
            )}
        </div>
    );
}
