'use client';

/**
 * Оплаты по своему заказу.
 *
 * Заказ, заведённый у нас, в RetailCRM не существует — провести платёж там
 * негде, поэтому журнал наш. Менеджер видит, сколько пришло и сколько осталось,
 * и каждая цифра раскладывается до платежей (закон «числа расшифровываемы»).
 */
import { useCallback, useEffect, useState } from 'react';
import { formatRub } from '@/lib/format';

type Payment = {
    id: number;
    amount: number;
    paidAt: string;
    method: string | null;
    payerName: string | null;
    purpose: string | null;
    note: string | null;
    createdBy: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function OwnOrderPayments({ orderId }: { orderId: number }) {
    const [state, setState] = useState<{ total: number; paid: number; left: number; payments: Payment[] } | null>(null);
    const [amount, setAmount] = useState('');
    const [paidAt, setPaidAt] = useState(today());
    const [method, setMethod] = useState('Банковский перевод');
    const [payerName, setPayerName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const response = await fetch(`/api/orders/${orderId}/payments`);
        const data = await response.json().catch(() => null);
        if (data?.own) {
            setState({ total: data.total, paid: data.paid, left: data.left, payments: data.payments });
        }
    }, [orderId]);

    useEffect(() => {
        load();
    }, [load]);

    const add = async () => {
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/orders/${orderId}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, paidAt, method, payerName: payerName || null }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || 'Не удалось записать оплату');
            }
            setState({ total: data.total, paid: data.paid, left: data.left, payments: data.payments });
            setAmount('');
            setPayerName('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось записать оплату');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (paymentId: number) => {
        const response = await fetch(`/api/orders/${orderId}/payments?paymentId=${paymentId}`, { method: 'DELETE' });
        const data = await response.json().catch(() => null);
        if (response.ok) {
            setState({ total: data.total, paid: data.paid, left: data.left, payments: data.payments });
        }
    };

    if (!state) {
        return null;
    }

    return (
        <div className="bg-white border border-gray-200 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Оплаты по заказу</h4>
                <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                    <span>Сумма заказа: <b className="text-gray-900 tabular-nums">{formatRub(state.total)}</b></span>
                    <span>Оплачено: <b className="text-gray-900 tabular-nums">{formatRub(state.paid)}</b></span>
                    <span>Осталось: <b className="text-gray-900 tabular-nums">{formatRub(state.left)}</b></span>
                </div>
            </div>

            {state.payments.length > 0 ? (
                <table className="w-full text-sm mb-4">
                    <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                            <th className="py-2">Дата</th>
                            <th className="py-2">Сумма</th>
                            <th className="py-2">Способ</th>
                            <th className="py-2">Плательщик</th>
                            <th className="py-2">Кто внёс</th>
                            <th className="py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {state.payments.map((payment) => (
                            <tr key={payment.id} className="border-b border-gray-50">
                                <td className="py-2 tabular-nums">{payment.paidAt.split('-').reverse().join('.')}</td>
                                <td className="py-2 tabular-nums font-semibold text-gray-900">{formatRub(payment.amount)}</td>
                                <td className="py-2 text-gray-600">{payment.method || '—'}</td>
                                <td className="py-2 text-gray-600">{payment.payerName || '—'}</td>
                                <td className="py-2 text-gray-500 text-xs">{payment.createdBy || '—'}</td>
                                <td className="py-2 text-right">
                                    <button
                                        type="button"
                                        onClick={() => remove(payment.id)}
                                        className="text-xs uppercase tracking-wide text-gray-400 hover:text-red-600"
                                    >
                                        Удалить
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <p className="text-sm text-gray-500 mb-4">Оплат по заказу пока нет.</p>
            )}

            <div className="grid gap-3 md:grid-cols-5 items-end border-t border-gray-100 pt-4">
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Сумма</span>
                    <input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-full border border-gray-300 px-3 py-2 text-sm tabular-nums"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Дата</span>
                    <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-full border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Способ</span>
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-gray-300 bg-white px-3 py-2 text-sm">
                        <option>Банковский перевод</option>
                        <option>Наличные</option>
                        <option>Карта</option>
                    </select>
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Плательщик</span>
                    <input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Кто заплатил" className="w-full border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <button
                    type="button"
                    onClick={add}
                    disabled={busy || !amount}
                    className="bg-gray-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600 disabled:opacity-40"
                >
                    {busy ? 'Пишем…' : 'Записать оплату'}
                </button>
            </div>

            {error && <p className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>}
        </div>
    );
}
