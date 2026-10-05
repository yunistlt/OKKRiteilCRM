'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Указать заказ входящего звонка.
 *
 * Решение владельца 05.10.2026: угадывать заказ по номеру мы перестали. Автомат
 * привязывает только очевидное — клиент опознан и у него ровно один открытый
 * заказ. Во всех прочих случаях заказ называет менеджер, и делает это здесь, не
 * уходя из разговора: список заказов этого номера плюс ручной ввод, если звонит
 * кто-то новый.
 */
export default function CallOrderPicker({
    callId,
    onBound,
}: {
    callId: string;
    /** Привязали — оповещение показывает номер заказа. */
    onBound: (orderNumber: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orders, setOrders] = useState<Array<{ orderId: number; number: string; status: string | null }>>([]);
    const [manual, setManual] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/calls/${encodeURIComponent(callId)}/order`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось получить заказы');
            setOrders(json.orders || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [callId]);

    useEffect(() => { if (open && !orders.length && !loading) void load(); }, [open, orders.length, loading, load]);

    const bind = async (orderId: number, number: string) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/calls/${encodeURIComponent(callId)}/order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось привязать');
            onBound(String(json.orderNumber ?? number));
            setOpen(false);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    // Ручной ввод: номер заказа человек знает из разговора.
    const bindByNumber = async () => {
        const number = manual.trim();
        if (!number) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders?search=${encodeURIComponent(number)}&pageSize=1`);
            const json = await res.json();
            const found = (json.orders || json.rows || json.items || [])[0];
            if (!found) throw new Error(`Заказа №${number} не нашли`);
            await bind(Number(found.id), String(found.number ?? number));
        } catch (e: any) {
            setError(e.message);
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-1 text-xs font-semibold text-blue-700 hover:underline"
            >
                указать заказ
            </button>
        );
    }

    return (
        <div className="mt-2 border border-gray-200">
            {loading && <p className="px-2 py-1.5 text-[11px] text-gray-500">Ищем заказы этого номера…</p>}

            {!loading && orders.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                    {orders.map((order) => (
                        <button
                            key={order.orderId}
                            type="button"
                            disabled={saving}
                            onClick={() => bind(order.orderId, order.number)}
                            className="block w-full border-b border-gray-100 px-2 py-1.5 text-left text-[11px] hover:bg-gray-50 disabled:text-gray-400"
                        >
                            <span className="font-semibold text-gray-900">№{order.number}</span>
                            {order.status && <span className="ml-2 text-gray-500">{order.status}</span>}
                        </button>
                    ))}
                </div>
            )}

            {!loading && !orders.length && (
                <p className="px-2 py-1.5 text-[11px] text-gray-500">Заказов по этому номеру не нашли — введите номер.</p>
            )}

            <div className="flex items-center gap-1 border-t border-gray-200 p-1.5">
                <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void bindByNumber(); }}
                    placeholder="Номер заказа"
                    className="w-full border border-gray-300 px-2 py-1 text-[11px]"
                />
                <button
                    type="button"
                    disabled={saving || !manual.trim()}
                    onClick={() => void bindByNumber()}
                    className="shrink-0 border border-gray-900 bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
                >
                    {saving ? '…' : 'Привязать'}
                </button>
            </div>

            {error && <p className="px-2 pb-1.5 text-[11px] text-red-700">{error}</p>}
        </div>
    );
}
