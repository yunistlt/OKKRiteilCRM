'use client';

import { useEffect, useState } from 'react';

/**
 * Короткая сводка по сделке во время разговора.
 *
 * Просьба владельца 05.10.2026: если менеджер говорит и заказ определён,
 * показывать краткое саммари. В разговоре некогда читать карточку — нужно за
 * секунду вспомнить, о чём сделка, где она стоит и что обещали.
 */
type Summary = {
    orderNumber: string;
    status: string | null;
    daysInStatus: number | null;
    sum: number | null;
    items: string[];
    itemsMore: number;
    client: string | null;
    manager: string | null;
    createdAt: string | null;
    lastEvent: string | null;
    lastEventAt: string | null;
    tasks: Array<{ title: string; due: string | null }>;
    nextContact: string | null;
    lastEmail: string | null;
    lastEmailAt: string | null;
};

const money = (value: number | null) =>
    value === null ? null : `${value.toLocaleString('ru-RU')} ₽`;

/** «3 дня», «1 день», «12 дней» — человеческим языком. */
function daysText(days: number): string {
    const last = days % 10;
    const teen = days % 100 >= 11 && days % 100 <= 14;
    if (teen || last === 0 || last >= 5) return `${days} дней`;
    if (last === 1) return `${days} день`;
    return `${days} дня`;
}

export default function CallSummary({ callId }: { callId: string }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/calls/${encodeURIComponent(callId)}/summary`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (!cancelled) { setSummary(data?.summary ?? null); setLoading(false); } })
            .catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [callId]);

    if (loading) return <div className="mt-2 text-[11px] text-gray-500">Собираем сводку…</div>;
    if (!summary) return null;

    return (
        <div className="mt-2 border-t border-gray-200 pt-2 text-[12px] leading-snug text-gray-800">
            <div className="flex flex-wrap items-baseline gap-x-2">
                {summary.status && <span className="font-semibold">{summary.status}</span>}
                {summary.daysInStatus !== null && (
                    <span className="text-gray-500">{daysText(summary.daysInStatus)} в статусе</span>
                )}
                {summary.sum !== null && <span className="ml-auto font-semibold">{money(summary.sum)}</span>}
            </div>

            {summary.items.length > 0 && (
                <div className="mt-1 text-gray-700">
                    {summary.items.join(' · ')}
                    {summary.itemsMore > 0 && <span className="text-gray-500"> и ещё {summary.itemsMore}</span>}
                </div>
            )}

            {summary.tasks.length > 0 && (
                <div className="mt-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Обещано</span>
                    {summary.tasks.map((task, index) => (
                        <div key={index} className="text-gray-800">
                            {task.title}
                            {task.due && <span className="text-gray-500"> — до {task.due}</span>}
                        </div>
                    ))}
                </div>
            )}

            {summary.nextContact && (
                <div className="mt-1 text-gray-700">Следующий контакт: {summary.nextContact}</div>
            )}

            {summary.lastEmail && (
                <div className="mt-1 truncate text-gray-600" title={summary.lastEmail}>
                    Письмо {summary.lastEmailAt}: {summary.lastEmail}
                </div>
            )}

            {summary.lastEvent && (
                <div className="mt-1 truncate text-gray-500" title={summary.lastEvent}>
                    Последнее {summary.lastEventAt}: {summary.lastEvent}
                </div>
            )}

            <div className="mt-1 text-gray-500">
                {summary.manager && <>Ведёт {summary.manager}</>}
                {summary.createdAt && <> · заведён {summary.createdAt}</>}
            </div>
        </div>
    );
}
