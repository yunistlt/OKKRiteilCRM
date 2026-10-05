'use client';

/**
 * Центр оповещений: колокольчик со счётчиком и лента событий по заказам.
 *
 * Решение владельца 05.10.2026: «нужно сделать так же, как в RetailCRM — тут
 * все оповещения менеджера, каждый видит свои, очень удобно». Всплывающие окна
 * показывают только то, что случилось сейчас; сюда заходят посмотреть, что
 * пропустили.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import OrderNumberLink from '@/components/ui/OrderNumberLink';

type Item = {
    id: string;
    kind: 'mail' | 'task' | 'call';
    at: string;
    text: string;
    note: string | null;
    orderNumber: string | null;
    read: boolean;
};

const KIND_LABEL: Record<Item['kind'], string> = {
    mail: 'Письмо',
    task: 'Задача',
    call: 'Звонок',
};

/** Как часто обновляем ленту. Чаще не нужно: всплывашки работают сами. */
const POLL_MS = 120_000;

export default function NotificationBell() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Item[]>([]);
    const [unread, setUnread] = useState(0);
    const [onlyUnread, setOnlyUnread] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/notifications');
            if (!res.ok) return;
            const data = await res.json();
            setItems(data.items || []);
            setUnread(Number(data.unread ?? 0));
        } catch {
            // Молча: оповещения — не повод пугать человека ошибкой.
        }
    }, []);

    useEffect(() => {
        void load();
        const timer = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(timer);
    }, [load]);

    const markRead = async (ids: string[]) => {
        if (!ids.length) return;
        setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)));
        setUnread((current) => Math.max(0, current - ids.length));
        await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        }).catch(() => undefined);
    };

    if (pathname === '/login' || pathname.startsWith('/messenger')) return null;

    const shown = onlyUnread ? items.filter((item) => !item.read) : items;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="relative px-2 py-1 text-gray-500 hover:text-gray-900"
                title="Оповещения"
                aria-label="Оповещения"
            >
                <span className="text-lg leading-none">🔔</span>
                {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-[16px] bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="fixed inset-0 z-[210] flex justify-end bg-black/20" onClick={() => setOpen(false)}>
                    <div
                        className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-900">Оповещения</span>
                                <span className="bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{items.length}</span>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-xl leading-none text-gray-400 hover:text-gray-900">×</button>
                        </div>

                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs">
                            <button
                                type="button"
                                onClick={() => markRead(items.filter((item) => !item.read).map((item) => item.id))}
                                className="font-semibold text-blue-700 hover:underline"
                            >
                                Прочитаны все
                            </button>
                            <label className="flex cursor-pointer items-center gap-2 text-gray-600">
                                <input
                                    type="checkbox"
                                    checked={onlyUnread}
                                    onChange={(e) => setOnlyUnread(e.target.checked)}
                                    className="h-3.5 w-3.5"
                                />
                                Скрыть прочитанные
                            </label>
                        </div>

                        <div className="flex-1 overflow-auto">
                            {shown.length === 0 && (
                                <p className="px-4 py-6 text-sm text-gray-500">
                                    {onlyUnread ? 'Непрочитанных нет.' : 'Оповещений за последнюю неделю нет.'}
                                </p>
                            )}
                            {shown.map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => !item.read && markRead([item.id])}
                                    className={`cursor-pointer border-b border-gray-100 px-4 py-3 ${item.read ? 'bg-white' : 'bg-blue-50'}`}
                                >
                                    <div className="flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
                                        <span>{KIND_LABEL[item.kind]}</span>
                                        <span>{new Date(item.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                    </div>
                                    <div className="mt-0.5 text-sm text-gray-900">{item.text}</div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                        {item.orderNumber && (
                                            <span onClick={(e) => e.stopPropagation()}>
                                                Заказ <OrderNumberLink number={item.orderNumber} />
                                            </span>
                                        )}
                                        {item.note && <span>{item.note}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
