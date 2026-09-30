'use client';

// Правка заказа: состав, цены, комментарии. Изменения уходят в RetailCRM —
// пока она источник правды, иначе производство увидит старую версию заказа.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRub } from '@/lib/format';
import { NumberInput } from '@/components/ui/NumberInput';

type Row = {
    id?: number | null;
    name: string;
    quantity: number;
    price: number;
    xmlId?: string | null;
};

type CatalogItem = { id: string; name: string; price: number; priceLive: boolean; category: string };

export default function EditOrderForm({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [number, setNumber] = useState<string>('');
    const [rows, setRows] = useState<Row[]>([]);
    const [customerComment, setCustomerComment] = useState('');
    const [managerComment, setManagerComment] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    const [query, setQuery] = useState('');
    const [found, setFound] = useState<CatalogItem[]>([]);
    const [catalogNote, setCatalogNote] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const response = await fetch(`/api/orders/${orderId}/details`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Не удалось открыть заказ');
                const order = payload.order || {};
                setNumber(String(order.number || orderId));
                setCustomerComment(order.customerComment || order.raw_payload?.customerComment || '');
                setManagerComment(order.managerComment || order.raw_payload?.managerComment || '');
                setRows((payload.items || order.raw_payload?.items || []).map((item: any) => ({
                    id: item.id ?? null,
                    name: item.offer?.displayName || item.offer?.name || item.productName || 'Позиция',
                    quantity: Number(item.quantity || 0),
                    price: Number(item.initialPrice || 0),
                })));
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        })();
    }, [orderId]);

    const search = useCallback(async (text: string) => {
        if (text.trim().length < 3) { setFound([]); setCatalogNote(null); return; }
        try {
            const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(text.trim())}`);
            const payload = await response.json();
            setFound(payload.items || []);
            setCatalogNote(payload.note || null);
        } catch {
            setCatalogNote('Каталог сайта не ответил — впишите позицию руками');
        }
    }, []);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => search(query), 400);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [query, search]);

    const total = rows.reduce((sum, row) => sum + Math.max(0, row.price * row.quantity), 0);

    const save = async () => {
        setSaving(true);
        setError(null);
        setDone(null);
        try {
            const response = await fetch(`/api/orders/${orderId}/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: rows.map((row) => ({ id: row.id ?? null, name: row.name, quantity: row.quantity, price: row.price, xmlId: row.xmlId ?? null })),
                    customerComment,
                    managerComment,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setDone(payload.changed?.length ? `Сохранено: ${payload.changed.join(', ')}` : 'Изменений не было');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="min-h-screen bg-gray-50 p-4 text-xs text-gray-500">Открываю заказ…</div>;
    }

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Заказ №{number}</h1>
                    <button onClick={() => router.push('/orders')} className="text-xs font-semibold text-gray-500 hover:text-gray-900">
                        ← К заказам
                    </button>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">Итого</span>
                    <span className="text-base font-bold text-gray-900">{formatRub(total)}</span>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-700 disabled:bg-gray-300"
                    >
                        {saving ? 'Сохраняю…' : 'Сохранить в CRM'}
                    </button>
                </div>
            </div>

            {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            {done && <div className="mb-3 border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">{done}</div>}

            <div className="min-h-0 flex-1 overflow-auto bg-white p-4 text-xs">
                <div className="mb-3 flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wide text-gray-700">Состав заказа</span>
                    <button
                        onClick={() => setRows((prev) => [...prev, { name: '', quantity: 1, price: 0 }])}
                        className="border border-gray-300 px-2 py-1 font-semibold text-gray-700 hover:bg-gray-100"
                    >
                        Добавить позицию руками
                    </button>
                </div>

                <div className="mb-3">
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Найти товар на сайте"
                        className="w-full border border-gray-300 px-2 py-1"
                    />
                    {catalogNote && <div className="mt-1 text-gray-500">{catalogNote}</div>}
                    {found.length > 0 && (
                        <div className="mt-1 max-h-40 overflow-auto border border-gray-200">
                            {found.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        setRows((prev) => [...prev, { name: item.name, quantity: 1, price: item.price, xmlId: item.id }]);
                                        setQuery('');
                                        setFound([]);
                                    }}
                                    className="block w-full border-b border-gray-100 px-2 py-2 text-left hover:bg-amber-50"
                                >
                                    <div className="text-gray-900">{item.name}</div>
                                    <div className="text-[11px] text-gray-500">{formatRub(item.price)}{item.priceLive ? ' · цена с сайта' : ' · цена из витрины'}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <table className="min-w-full text-xs">
                    <thead className="bg-gray-100 text-left text-gray-600">
                        <tr>
                            <th className="px-2 py-2">Позиция</th>
                            <th className="w-24 px-2 py-2 text-right">Кол-во</th>
                            <th className="w-32 px-2 py-2 text-right">Цена</th>
                            <th className="w-32 px-2 py-2 text-right">Сумма</th>
                            <th className="w-8 px-2 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={index} className="border-b border-gray-100">
                                <td className="px-2 py-2">
                                    <input
                                        value={row.name}
                                        onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, name: e.target.value } : r))}
                                        className="w-full border border-gray-300 px-2 py-1"
                                    />
                                </td>
                                <td className="px-2 py-2">
                                    <NumberInput
                                        value={row.quantity}
                                        onChange={(v: number | null) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, quantity: Number(v) || 0 } : r))}
                                        className="w-full border border-gray-300 px-2 py-1 text-right"
                                    />
                                </td>
                                <td className="px-2 py-2">
                                    <NumberInput
                                        value={row.price}
                                        onChange={(v: number | null) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, price: Number(v) || 0 } : r))}
                                        className="w-full border border-gray-300 px-2 py-1 text-right"
                                    />
                                </td>
                                <td className="px-2 py-2 text-right text-gray-900">{formatRub(Math.max(0, row.price * row.quantity))}</td>
                                <td className="px-2 py-2 text-right">
                                    <button onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))} className="text-gray-400 hover:text-red-600">×</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Комментарий клиента</span>
                        <textarea value={customerComment} onChange={(e) => setCustomerComment(e.target.value)} rows={5} className="w-full border border-gray-300 px-2 py-1" />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Комментарий менеджера</span>
                        <textarea value={managerComment} onChange={(e) => setManagerComment(e.target.value)} rows={5} className="w-full border border-gray-300 px-2 py-1" />
                    </label>
                </div>
            </div>
        </div>
    );
}
