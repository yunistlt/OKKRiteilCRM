'use client';

/**
 * Набор номера с указанием заказа.
 *
 * Решение владельца 15.10.2026: набрать «в никуда» нельзя — перед тем как
 * пойдёт гудок, система спрашивает, по какому заказу звонок. Причина в разборе
 * звонка 07.10.2026 на +79787129992: набрали из списка звонков, заказ не
 * назвали, и разговор остался ничьим, хотя телефон принадлежит ровно одному
 * заказу 39775.
 *
 * Привязка должна приходить ВМЕСТЕ с набором (закон 05.10.2026 «мы ничего не
 * матчим»), поэтому спрашиваем до звонка, а не после:
 *   • заказ один — подставляем и набираем сразу;
 *   • заказов несколько — менеджер выбирает;
 *   • заказов нет — звоним «без заказа» отдельной кнопкой (новый клиент,
 *     поставщик), и это видно в реестре.
 */
import { useState } from 'react';

type Order = { orderId: number; number: string; status: string | null };

export default function DialWithOrder({
    phone,
    managerId,
    label = 'Позвонить',
    className,
    onDialed,
}: {
    phone: string;
    /** Номер менеджера в CRM: без него звонить нечем. */
    managerId: number | null | undefined;
    label?: string;
    className?: string;
    /** Сообщение о том, чем кончился набор, — показывает вызывающий экран. */
    onDialed?: (note: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    const [note, setNote] = useState<string | null>(null);

    const say = (text: string) => {
        setNote(text);
        onDialed?.(text);
    };

    const dial = async (orderId: number | null, orderNumber?: string) => {
        setBusy(true);
        try {
            const res = await fetch('/api/calls/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone, managerId, orderId }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Звонок не пошёл');

            setAsking(false);
            say(payload.mock
                ? 'Демо-режим: звонок не совершён, ключи телефонии не заданы.'
                : orderId
                    ? `Звоним на ${phone} по заказу ${orderNumber} — поднимите трубку софтфона.`
                    : `Звоним на ${phone} без заказа — поднимите трубку софтфона.`);
        } catch (e: any) {
            say(e.message || 'Звонок не пошёл');
        } finally {
            setBusy(false);
        }
    };

    const start = async () => {
        if (!managerId) {
            say('Ваша учётка не связана с менеджером — звонить нечем. Скажите администратору.');
            return;
        }

        setBusy(true);
        setNote(null);
        try {
            const res = await fetch(`/api/calls/orders-by-phone?phone=${encodeURIComponent(phone)}`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось посмотреть заказы номера');

            const found: Order[] = payload.orders || [];
            setOrders(found);

            // Заказ один — спрашивать нечего, он и есть ответ.
            if (found.length === 1) {
                await dial(found[0].orderId, found[0].number);
                return;
            }

            setAsking(true);
        } catch (e: any) {
            say(e.message || 'Не удалось посмотреть заказы номера');
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className="relative inline-block">
            <button
                type="button"
                disabled={busy}
                onClick={() => (asking ? setAsking(false) : void start())}
                className={className ?? 'border border-gray-900 px-2 py-0.5 text-[11px] font-semibold text-gray-900 hover:bg-gray-900 hover:text-white disabled:border-gray-300 disabled:text-gray-400'}
            >
                {busy ? 'Звоню…' : label}
            </button>

            {asking && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 border border-gray-300 bg-white p-2 text-left shadow-lg">
                    <div className="mb-1 text-[11px] font-black uppercase tracking-widest text-gray-500">
                        По какому заказу звоните?
                    </div>

                    {orders.length === 0 ? (
                        <div className="mb-2 text-xs text-gray-600">
                            Заказов с этим номером нет. Это новый клиент или не клиент — тогда звоните без заказа.
                        </div>
                    ) : (
                        <div className="mb-2 max-h-48 overflow-auto">
                            {orders.map((order) => (
                                <button
                                    key={order.orderId}
                                    type="button"
                                    onClick={() => void dial(order.orderId, order.number)}
                                    className="block w-full border-b border-gray-100 px-1 py-1.5 text-left text-xs hover:bg-amber-50"
                                >
                                    <span className="font-semibold text-gray-900">{order.number}</span>
                                    {order.status && <span className="ml-2 text-gray-500">{order.status}</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => void dial(null)}
                            className="border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
                        >
                            Позвонить без заказа
                        </button>
                        <button
                            type="button"
                            onClick={() => setAsking(false)}
                            className="px-1 text-[11px] text-gray-500 hover:text-gray-900"
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            )}

            {note && !asking && <span className="ml-2 text-[11px] text-gray-600">{note}</span>}
        </span>
    );
}
