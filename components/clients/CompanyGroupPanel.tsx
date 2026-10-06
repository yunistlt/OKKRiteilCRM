'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Группа компаний в карточке клиента.
 *
 * Решение владельца 06.10.2026: «у одного покупателя несколько юридических
 * лиц — ЗМК, ИП, УБТ, — но по сути это один клиент. Продав любому лицу,
 * засчитываем как один покупатель». Склейки по ИНН не хватает: у белорусов
 * ИНН нет вовсе, а разные юрлица одного владельца по ИНН не склеить.
 *
 * Группы ведут менеджеры руками — автоподбора нет, это решение владельца:
 * «менеджеры сами постепенно создадут».
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
    const [opening, setOpening] = useState(false);
    const [name, setName] = useState('');
    const [found, setFound] = useState<Array<{ id: number; name: string; members: number }>>([]);
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

    /** Готовые группы — чтобы не заводить вторую с тем же смыслом. */
    useEffect(() => {
        if (!opening) return;
        let alive = true;
        const timer = setTimeout(async () => {
            const res = await fetch(`/api/company-groups?q=${encodeURIComponent(name.trim())}`);
            const payload = await res.json();
            if (alive) setFound(payload.groups || []);
        }, 250);
        return () => { alive = false; clearTimeout(timer); };
    }, [opening, name]);

    const send = async (body: any) => {
        setBusy(true);
        setProblem(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setGroup(payload.group ?? null);
            setOpening(false);
            setName('');
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
            ) : opening ? (
                <div className="space-y-2 px-4 py-3">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Название группы"
                        className="w-full border border-gray-300 px-2 py-1 text-xs"
                    />
                    {found.length > 0 && (
                        <div>
                            <div className="text-[11px] uppercase tracking-wide text-gray-400">Уже заведены</div>
                            {found.map((g) => (
                                <button
                                    key={g.id}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => send({ groupId: g.id })}
                                    className="block w-full px-1 py-1 text-left text-xs text-blue-700 hover:underline"
                                >
                                    {g.name} · {g.members} юрлиц
                                </button>
                            ))}
                        </div>
                    )}
                    {problem && <div className="text-[11px] text-red-600">{problem}</div>}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={busy || !name.trim()}
                            onClick={() => send({ name: name.trim() })}
                            className="border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-100 disabled:text-gray-400"
                        >
                            Создать группу
                        </button>
                        <button
                            type="button"
                            onClick={() => { setOpening(false); setProblem(null); }}
                            className="px-2 py-1 text-xs text-gray-500 hover:underline"
                        >
                            отмена
                        </button>
                    </div>
                </div>
            ) : (
                <div className="px-4 py-3">
                    <div className="text-gray-500">Карточка не входит ни в одну группу.</div>
                    <button
                        type="button"
                        onClick={() => { setOpening(true); setName(clientName || ''); }}
                        className="mt-2 border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-100"
                    >
                        Объединить с другими юрлицами
                    </button>
                </div>
            )}
        </>
    );
}
