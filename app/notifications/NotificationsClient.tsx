'use client';

/**
 * Лента оповещений: письма, задачи и звонки по заказам человека.
 *
 * То же, что в колокольчике, но на всю страницу и с отбором по виду события —
 * разбирать накопившееся в узкой панели неудобно.
 */
import { useCallback, useEffect, useState } from 'react';
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

const KINDS: Array<{ code: '' | Item['kind']; label: string }> = [
    { code: '', label: 'Все' },
    { code: 'mail', label: 'Письма' },
    { code: 'task', label: 'Задачи' },
    { code: 'call', label: 'Звонки' },
];

const KIND_LABEL: Record<Item['kind'], string> = { mail: 'Письмо', task: 'Задача', call: 'Звонок' };

export default function NotificationsClient() {
    const [items, setItems] = useState<Item[]>([]);
    const [kind, setKind] = useState<'' | Item['kind']>('');
    const [onlyUnread, setOnlyUnread] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/notifications');
            const data = await res.json();
            setItems(data.items || []);
        } catch {
            // Пустая лента честнее, чем страшная ошибка на весь экран.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const markRead = async (ids: string[]) => {
        if (!ids.length) return;
        setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)));
        await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        }).catch(() => undefined);
    };

    const shown = items
        .filter((item) => (kind ? item.kind === kind : true))
        .filter((item) => (onlyUnread ? !item.read : true));

    const unread = items.filter((item) => !item.read).length;

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Оповещения</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Письма, задачи и входящие звонки по вашим заказам за последнюю неделю.
                </p>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                {KINDS.map((k) => (
                    <button
                        key={k.code || 'all'}
                        type="button"
                        onClick={() => setKind(k.code)}
                        className={`px-3 py-1.5 text-sm font-semibold ${
                            kind === k.code ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                        }`}
                    >
                        {k.label}
                    </button>
                ))}
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} className="h-4 w-4" />
                    Скрыть прочитанные
                </label>
                <button
                    type="button"
                    disabled={!unread}
                    onClick={() => markRead(items.filter((item) => !item.read).map((item) => item.id))}
                    className="border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 disabled:text-gray-400"
                >
                    Прочитаны все{unread ? ` (${unread})` : ''}
                </button>
            </div>

            {loading && <p className="text-sm text-gray-500">Загружаю…</p>}
            {!loading && shown.length === 0 && (
                <p className="bg-white px-4 py-6 text-sm text-gray-500">Оповещений нет.</p>
            )}

            <div className="border border-gray-200 bg-white">
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
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-gray-600">
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
    );
}
