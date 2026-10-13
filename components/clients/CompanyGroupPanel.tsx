'use client';

import { useCallback, useEffect, useState } from 'react';
import CompanyPickerModal from './CompanyPickerModal';

/**
 * Группа компаний в карточке клиента.
 *
 * Решение владельца 06.10.2026: «у одного покупателя несколько юридических
 * лиц — ЗМК, ИП, УБТ, — но по сути это один клиент. Продав любому лицу,
 * засчитываем как один покупатель». Склейки по ИНН не хватает: у белорусов
 * ИНН нет вовсе, а разные юрлица одного владельца по ИНН не склеить.
 *
 * Как собирается группа (уточнение владельца того же дня): менеджер жмёт
 * «Добавить компании», в окне ищет нужные юрлица по названию или ИНН и
 * отмечает их. Система ничего не советует и не угадывает — какие фирмы
 * относятся к одному покупателю, знает только менеджер.
 */
export interface GroupMember {
    clientId: number;
    name: string;
    inn: string | null;
    deals: number;
}

export interface CompanyGroup {
    id: number;
    name: string;
    note: string | null;
    members: GroupMember[];
}

export default function CompanyGroupPanel({
    clientId,
    clientName,
    onChanged,
}: {
    clientId: string | number;
    /** Имя текущего клиента — предлагаем его названием новой группы. */
    clientName: string;
    /** Группа изменилась: карточке стоит перечитать свои данные. */
    onChanged?: () => void;
}) {
    const [group, setGroup] = useState<CompanyGroup | null>(null);
    const [loading, setLoading] = useState(true);
    const [picking, setPicking] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/clients/${clientId}/group`);
            const payload = await res.json();
            setGroup(payload.group ?? null);
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    /**
     * Отмеченные компании уходят в группу. Группы ещё нет — заводим её здесь
     * же: названием берём имя текущей компании, отдельно спрашивать не о чем.
     */
    const addCompanies = async (ids: number[]) => {
        setBusy(true);
        setProblem(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: clientName || `Группа №${clientId}`, add: ids }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setGroup(payload.group ?? null);
            onChanged?.();
        } catch (e: any) {
            setProblem(e.message);
        } finally {
            setBusy(false);
        }
    };

    const leave = async () => {
        setBusy(true);
        try {
            await fetch(`/api/clients/${clientId}/group`, { method: 'DELETE' });
            setGroup(null);
            onChanged?.();
        } finally {
            setBusy(false);
        }
    };

    const totalDeals = (group?.members ?? []).reduce((sum, m) => sum + m.deals, 0);

    return (
        <>
            <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                Группа компаний
            </div>

            {loading ? (
                <div className="px-4 py-3 text-gray-500">Смотрим…</div>
            ) : group ? (
                <>
                    <div className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{group.name}</div>
                        <div className="text-[11px] text-gray-500">
                            {group.members.length} юрлиц · {totalDeals} сделок на группу
                        </div>
                    </div>
                    {group.members.map((m) => (
                        <div
                            key={m.clientId}
                            className={`flex items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-2 ${
                                String(m.clientId) === String(clientId) ? 'bg-amber-50' : ''
                            }`}
                        >
                            <div className="min-w-0">
                                <div className="truncate text-gray-900">{m.name}</div>
                                <div className="text-[11px] text-gray-500">
                                    {m.deals} сделок{m.inn ? ` · ИНН ${m.inn}` : ''}
                                </div>
                            </div>
                            {String(m.clientId) === String(clientId) && (
                                <button
                                    type="button"
                                    onClick={leave}
                                    disabled={busy}
                                    className="shrink-0 text-[11px] text-blue-700 hover:underline disabled:text-gray-400"
                                >
                                    выйти
                                </button>
                            )}
                        </div>
                    ))}
                    <div className="px-4 py-2 text-[11px] text-gray-500">
                        Покупки всех юрлиц группы считаются покупками одного клиента.
                    </div>
                </>
            ) : (
                <div className="px-4 py-3">
                    <div className="text-gray-500">Карточка не входит ни в одну группу.</div>
                </div>
            )}

            {/* Кнопка одна и в обоих случаях: нет группы — заведём при первом
                добавлении, есть — дополняем. Выбор компаний только руками. */}
            <div className="px-4 py-2">
                {problem && <div className="mb-1 text-[11px] text-red-600">{problem}</div>}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPicking(true)}
                    className="border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-100 disabled:text-gray-400"
                >
                    Добавить компании
                </button>
            </div>

            {picking && (
                <CompanyPickerModal
                    excludeIds={[Number(clientId), ...(group?.members ?? []).map((m) => m.clientId)]}
                    onClose={() => setPicking(false)}
                    onPick={addCompanies}
                />
            )}
        </>
    );
}
