'use client';

// Создание заказа менеджером. Позиции подбираются прямо из каталога сайта —
// своей копии товаров у нас нет. Если каталог не отвечает, позицию можно
// вписать руками: заказ важнее подсказки.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRub, priceSourceLabel } from '@/lib/format';
import { NumberInput } from '@/components/ui/NumberInput';

type CatalogItem = {
    id: string;
    name: string;
    price: number;
    priceLive: boolean;
    priceSource?: 'live' | 'cache' | 'none';
    category: string;
    active: boolean;
};

type Row = {
    name: string;
    quantity: number;
    price: number;
    xmlId?: string | null;
};

export default function NewOrderForm() {
    const router = useRouter();
    const [contactName, setContactName] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [inn, setInn] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [comment, setComment] = useState('');
    const [rows, setRows] = useState<Row[]>([]);

    const [query, setQuery] = useState('');
    const [found, setFound] = useState<CatalogItem[]>([]);
    const [catalogNote, setCatalogNote] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const search = useCallback(async (text: string) => {
        if (text.trim().length < 3) {
            setFound([]);
            setCatalogNote(null);
            return;
        }
        setSearching(true);
        try {
            const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(text.trim())}`);
            const payload = await response.json();
            setFound(payload.items || []);
            setCatalogNote(payload.note || (payload.unavailable ? payload.note : null));
        } catch {
            setFound([]);
            setCatalogNote('Каталог сайта не ответил — впишите позицию руками');
        } finally {
            setSearching(false);
        }
    }, []);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => search(query), 400);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [query, search]);

    const addRow = (item?: CatalogItem) => {
        setRows((prev) => [...prev, item
            ? { name: item.name, quantity: 1, price: item.price, xmlId: item.id }
            : { name: '', quantity: 1, price: 0 }]);
        if (item) {
            setQuery('');
            setFound([]);
        }
    };

    const total = rows.reduce((sum, row) => sum + Math.max(0, row.price * row.quantity), 0);

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            const response = await fetch('/api/orders/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contactName: contactName || null,
                    companyName: companyName || null,
                    inn: inn || null,
                    phone: phone || null,
                    email: email || null,
                    customerComment: comment || null,
                    items: rows.map((row) => ({ name: row.name, quantity: row.quantity, price: row.price, xmlId: row.xmlId ?? null })),
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось создать заказ');
            router.push(`/orders?number=${payload.number}`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Новый заказ</h1>
                    <a href="/orders" className="text-xs font-semibold text-gray-500 hover:text-gray-900">← К заказам</a>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">Итого</span>
                    <span className="text-base font-bold text-gray-900">{formatRub(total)}</span>
                    <button
                        onClick={submit}
                        disabled={saving || rows.length === 0}
                        className="bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-700 disabled:bg-gray-300"
                    >
                        {saving ? 'Создаю…' : 'Создать заказ'}
                    </button>
                </div>
            </div>

            {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-gray-200 lg:grid-cols-3">
                <div className="bg-white p-4 text-xs">
                    <div className="mb-3 font-bold uppercase tracking-wide text-gray-700">Клиент</div>
                    {[
                        ['Компания', companyName, setCompanyName, 'ООО «Ромашка»'],
                        ['ИНН', inn, setInn, '7701234567'],
                        ['Контактное лицо', contactName, setContactName, 'Иван Петров'],
                        ['Телефон', phone, setPhone, '+7 900 123-45-67'],
                        ['Почта', email, setEmail, 'client@example.ru'],
                    ].map(([label, value, setter, placeholder]: any) => (
                        <label key={label} className="mb-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
                            <input
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                placeholder={placeholder}
                                className="w-full border border-gray-300 px-2 py-1"
                            />
                        </label>
                    ))}
                    <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Что просит клиент</span>
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            rows={4}
                            className="w-full border border-gray-300 px-2 py-1"
                        />
                    </label>
                </div>

                <div className="bg-white p-4 text-xs lg:col-span-2">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="font-bold uppercase tracking-wide text-gray-700">Состав заказа</span>
                        <button onClick={() => addRow()} className="border border-gray-300 px-2 py-1 font-semibold text-gray-700 hover:bg-gray-100">
                            Добавить позицию руками
                        </button>
                    </div>

                    <div className="mb-3">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Найти товар на сайте — название или часть названия"
                            className="w-full border border-gray-300 px-2 py-1"
                        />
                        {searching && <div className="mt-1 text-gray-500">Ищу на сайте…</div>}
                        {catalogNote && <div className="mt-1 text-gray-500">{catalogNote}</div>}
                        {found.length > 0 && (
                            <div className="mt-1 max-h-48 overflow-auto border border-gray-200">
                                {found.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => addRow(item)}
                                        className="block w-full border-b border-gray-100 px-2 py-2 text-left hover:bg-amber-50"
                                    >
                                        <div className="text-gray-900">{item.name}</div>
                                        <div className="text-[11px] text-gray-500">
                                            {item.priceSource === 'none' ? 'Цена не указана' : formatRub(item.price)}
                                            {' · '}
                                            <span className={item.priceSource === 'none' ? 'text-amber-800' : ''}>
                                                {priceSourceLabel(item.priceSource, item.priceLive)}
                                            </span>
                                            {item.category ? ` · ${item.category}` : ''}
                                            {!item.active ? ' · снят с продажи' : ''}
                                        </div>
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
                            {rows.length === 0 && (
                                <tr><td colSpan={5} className="px-2 py-6 text-center text-gray-500">Позиций нет — найдите товар или добавьте руками</td></tr>
                            )}
                            {rows.map((row, index) => (
                                <tr key={index} className="border-b border-gray-100">
                                    <td className="px-2 py-2">
                                        <input
                                            value={row.name}
                                            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, name: e.target.value } : r))}
                                            placeholder="Название позиции"
                                            className="w-full border border-gray-300 px-2 py-1"
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        <NumberInput
                                            value={row.quantity}
                                            onChange={(v: number | null) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, quantity: Number(v) || 0 } : r))}
                                            className="w-full border border-gray-300 px-2 py-1 text-right"
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        <NumberInput
                                            value={row.price}
                                            onChange={(v: number | null) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, price: Number(v) || 0 } : r))}
                                            className="w-full border border-gray-300 px-2 py-1 text-right"
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-right text-gray-900">{formatRub(Math.max(0, row.price * row.quantity))}</td>
                                    <td className="px-2 py-2 text-right">
                                        <button
                                            onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                                            className="text-gray-400 hover:text-red-600"
                                            title="Убрать позицию"
                                        >
                                            ×
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
