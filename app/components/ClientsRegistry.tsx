'use client';

// Реестр клиентов: строка — одно юрлицо в CRM. Поиск серверный: по названию,
// контакту, ИНН, почте и телефону. Скроллится только тело таблицы.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatIntRu, formatRub } from '@/lib/format';

type ClientRow = {
    id: string;
    company_name: string | null;
    contact_name: string | null;
    inn: string | null;
    phones: string[] | null;
    phone_from_order: string | null;
    email: string | null;
    orders_count: number | null;
    total_summ: number | null;
    average_check: number | null;
    last_order_at: string | null;
};

const SORTS: { key: string; label: string }[] = [
    { key: 'total_summ', label: 'По сумме покупок' },
    { key: 'orders_count', label: 'По числу заказов' },
    { key: 'last_order_at', label: 'По дате последнего заказа' },
    { key: 'company_name', label: 'По названию' },
];

function Dash() {
    return <span className="text-gray-300">—</span>;
}

function formatDate(value: string | null) {
    if (!value) return null;
    return new Date(value).toLocaleDateString('ru-RU');
}

export default function ClientsRegistry() {
    const router = useRouter();
    const [rows, setRows] = useState<ClientRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [sort, setSort] = useState('total_summ');
    const [query, setQuery] = useState('');
    const [applied, setApplied] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
            if (applied) params.set('q', applied);
            const response = await fetch(`/api/clients?${params.toString()}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось получить список клиентов');
            setRows(payload.clients || []);
            setTotal(payload.total || 0);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, sort, applied]);

    useEffect(() => {
        load();
    }, [load]);

    const pages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Клиенты</h1>
                    <span className="text-xs text-gray-500">найдено {formatIntRu(total)}</span>
                </div>
                <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setPage(1);
                        setApplied(query.trim());
                    }}
                >
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Название, ИНН, телефон или почта"
                        className="w-72 border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button type="submit" className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">
                        Найти
                    </button>
                    {applied && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery('');
                                setApplied('');
                                setPage(1);
                            }}
                            className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-900"
                        >
                            Сбросить
                        </button>
                    )}
                    <select
                        value={sort}
                        onChange={(e) => {
                            setSort(e.target.value);
                            setPage(1);
                        }}
                        className="border border-gray-300 px-2 py-1 text-xs"
                    >
                        {SORTS.map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                    </select>
                </form>
            </div>

            {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            <div className="min-h-0 flex-1 overflow-auto bg-white">
                <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-100 text-left text-gray-600">
                        <tr>
                            <th className="px-4 py-3">Клиент</th>
                            <th className="px-4 py-3">Контакт</th>
                            <th className="px-4 py-3">ИНН</th>
                            <th className="px-4 py-3">Телефон</th>
                            <th className="px-4 py-3">Почта</th>
                            <th className="px-4 py-3 text-right">Заказов</th>
                            <th className="px-4 py-3 text-right">Купил на</th>
                            <th className="px-4 py-3 text-right">Средний чек</th>
                            <th className="px-4 py-3">Последний заказ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Загружаю…</td></tr>
                        )}
                        {!loading && rows.length === 0 && (
                            <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Ничего не нашлось</td></tr>
                        )}
                        {!loading && rows.map((row, index) => (
                            <tr
                                key={row.id}
                                onClick={() => router.push(`/clients/${row.id}`)}
                                className={`cursor-pointer border-b border-gray-100 hover:bg-amber-50 ${index % 2 ? 'bg-gray-50' : ''}`}
                            >
                                <td className="px-4 py-3 font-semibold text-gray-900">{row.company_name || <Dash />}</td>
                                <td className="px-4 py-3">{row.contact_name || <Dash />}</td>
                                <td className="px-4 py-3">{row.inn || <Dash />}</td>
                                <td className="px-4 py-3">{row.phone_from_order || row.phones?.[0] || <Dash />}</td>
                                <td className="px-4 py-3">{row.email || <Dash />}</td>
                                <td className="px-4 py-3 text-right">{row.orders_count ? formatIntRu(row.orders_count) : <Dash />}</td>
                                <td className="px-4 py-3 text-right">{row.total_summ ? formatRub(row.total_summ) : <Dash />}</td>
                                <td className="px-4 py-3 text-right">{row.average_check ? formatRub(row.average_check) : <Dash />}</td>
                                <td className="px-4 py-3">{formatDate(row.last_order_at) || <Dash />}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                    <span>Строк на странице</span>
                    {[20, 50, 100].map((size) => (
                        <button
                            key={size}
                            onClick={() => { setPageSize(size); setPage(1); }}
                            className={`px-2 py-1 font-semibold ${pageSize === size ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            {size}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-1 font-semibold disabled:text-gray-300"
                    >
                        Назад
                    </button>
                    <span>страница {formatIntRu(page)} из {formatIntRu(pages)}</span>
                    <button
                        disabled={page >= pages}
                        onClick={() => setPage((p) => Math.min(pages, p + 1))}
                        className="px-2 py-1 font-semibold disabled:text-gray-300"
                    >
                        Вперёд
                    </button>
                </div>
            </div>
        </div>
    );
}
