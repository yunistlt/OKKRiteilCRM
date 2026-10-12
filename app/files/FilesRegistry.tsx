'use client';

// Все файлы заказов одним списком с поиском по названию и номеру заказа.
// Нужен, чтобы найти паспорт изделия, не помня, в каком заказе он лежит.
import { useCallback, useEffect, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import { orderFileHref } from '@/lib/orders/file-href';
import { formatIntRu } from '@/lib/format';

type FileRow = {
    id: number;
    orderNumber: string;
    name: string;
    contentType: string | null;
    size: number | null;
    uploadedBy: string | null;
    note: string | null;
    forProduction: boolean;
    at: string;
};

function formatSize(bytes: number | null) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${formatIntRu(Math.round(bytes / 1024))} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

function formatMoment(value: string) {
    const date = new Date(value);
    return `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function FilesRegistry() {
    const [rows, setRows] = useState<FileRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [query, setQuery] = useState('');
    const [applied, setApplied] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
            if (applied) params.set('q', applied);
            const response = await fetch(`/api/files?${params.toString()}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось получить список файлов');
            setRows(payload.files || []);
            setTotal(payload.total || 0);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, applied]);

    useEffect(() => {
        load();
    }, [load]);

    const pages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Файлы</h1>
                    <span className="text-xs text-gray-500">всего {formatIntRu(total)}</span>
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
                        placeholder="Название файла или номер заказа"
                        className="w-80 border border-gray-300 px-2 py-1 text-xs"
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
                </form>
            </div>

            {/* Закон «заглушки видны»: честно говорим, чего в списке нет. */}
            <div className="mb-2 text-[11px] text-gray-500">
                Здесь файлы, приложенные к заказам. Вложения писем у нас не хранятся — они открываются из переписки в карточке заказа.
            </div>

            {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            <div className="min-h-0 flex-1 overflow-auto bg-white">
                <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-100 text-left text-gray-600">
                        <tr>
                            <th className="px-4 py-3">Файл</th>
                            <th className="px-4 py-3">Заказ</th>
                            <th className="px-4 py-3 text-right">Размер</th>
                            <th className="px-4 py-3">Приложил</th>
                            <th className="px-4 py-3">Когда</th>
                            <th className="px-4 py-3">Примечание</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Загружаю…</td></tr>
                        )}
                        {!loading && rows.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Ничего не нашлось</td></tr>
                        )}
                        {!loading && rows.map((row, index) => (
                            <tr key={row.id} className={`border-b border-gray-100 hover:bg-amber-50 ${index % 2 ? 'bg-gray-50' : ''}`}>
                                <td className="px-4 py-3">
                                    <a
                                        href={orderFileHref({ orderNumber: row.orderNumber, fileId: row.id })}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-semibold text-blue-700 hover:underline"
                                    >
                                        {row.name}
                                    </a>
                                    {row.forProduction && (
                                        <span className="ml-2 bg-gray-900 px-1 py-0.5 text-[10px] font-semibold text-white">в производство</span>
                                    )}
                                </td>
                                <td className="px-4 py-3"><OrderNumberLink number={row.orderNumber} /></td>
                                <td className="px-4 py-3 text-right text-gray-600">{formatSize(row.size)}</td>
                                <td className="px-4 py-3 text-gray-600">{row.uploadedBy || '—'}</td>
                                <td className="px-4 py-3 text-gray-600">{formatMoment(row.at)}</td>
                                <td className="px-4 py-3 text-gray-600">{row.note || '—'}</td>
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
                            type="button"
                            onClick={() => {
                                setPageSize(size);
                                setPage(1);
                            }}
                            className={`px-2 py-1 font-semibold ${pageSize === size ? 'bg-gray-900 text-white' : 'hover:bg-gray-200'}`}
                        >
                            {size}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-1 font-semibold disabled:text-gray-300 hover:bg-gray-200"
                    >
                        ← Назад
                    </button>
                    <span>страница {formatIntRu(page)} из {formatIntRu(pages)}</span>
                    <button
                        type="button"
                        disabled={page >= pages}
                        onClick={() => setPage((p) => Math.min(pages, p + 1))}
                        className="px-2 py-1 font-semibold disabled:text-gray-300 hover:bg-gray-200"
                    >
                        Вперёд →
                    </button>
                </div>
            </div>
        </div>
    );
}
