'use client';

// Все файлы заказов одним списком: поиск, фильтр по каждой колонке и порядок
// строк по любой колонке — золотой стандарт таблиц (golds/GOLD_UI_TABLES.md).
// Ширина колонок и раскладка запоминаются за человеком на сервере.
import { useCallback, useEffect, useRef, useState } from 'react';
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

type SortKey = 'name' | 'order' | 'size' | 'uploadedBy' | 'at' | 'note';

const COLUMNS: { key: SortKey; title: string; align?: 'right' }[] = [
    { key: 'name', title: 'Файл' },
    { key: 'order', title: 'Заказ' },
    { key: 'size', title: 'Размер', align: 'right' },
    { key: 'uploadedBy', title: 'Приложил' },
    { key: 'at', title: 'Когда' },
    { key: 'note', title: 'Примечание' },
];

/** Что набрано в строке фильтров под шапкой таблицы. */
type Filters = {
    name: string;
    order: string;
    sizeFrom: string;
    sizeTo: string;
    dateFrom: string;
    dateTo: string;
    uploadedBy: string;
    note: string;
};

const EMPTY_FILTERS: Filters = {
    name: '', order: '', sizeFrom: '', sizeTo: '', dateFrom: '', dateTo: '', uploadedBy: '', note: '',
};

const VIEW_KEY = 'files.layout';

const PAGE_SIZES = [20, 50, 100];

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
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    /** Применённые фильтры: набор в полях не дёргает сервер на каждую букву. */
    const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'at', dir: 'desc' });
    const [widths, setWidths] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Набор в поле фильтра ждёт полсекунды — иначе запрос на каждую букву.
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => {
            setAppliedFilters(filters);
            setPage(1);
        }, 500);
        return () => { if (debounce.current) clearTimeout(debounce.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    // Раскладка (ширины и порядок строк) — за человеком на сервере, закон §7.
    useEffect(() => {
        fetch(`/api/settings/view?viewKey=${VIEW_KEY}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((payload) => {
                const saved = payload?.settings;
                if (!saved) return;
                if (saved.widths && typeof saved.widths === 'object') setWidths(saved.widths);
                if (saved.sort?.key) setSort({ key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
                if (PAGE_SIZES.includes(Number(saved.pageSize))) setPageSize(Number(saved.pageSize));
            })
            .catch(() => undefined);
    }, []);

    const saveLayout = useCallback((next: { widths?: Record<string, number>; sort?: typeof sort; pageSize?: number }) => {
        fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                viewKey: VIEW_KEY,
                settings: {
                    widths: next.widths ?? widths,
                    sort: next.sort ?? sort,
                    pageSize: next.pageSize ?? pageSize,
                },
            }),
        }).catch(() => undefined);
    }, [widths, sort, pageSize]);

    const toggleSort = (key: SortKey) => {
        const next: { key: SortKey; dir: 'asc' | 'desc' } = sort.key === key
            ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' };
        setSort(next);
        setPage(1);
        saveLayout({ sort: next });
    };

    /** Тянем правый край заголовка — меняем ширину колонки (минимум 80 px). */
    const startResize = (event: React.MouseEvent, key: string) => {
        event.preventDefault();
        event.stopPropagation();
        const th = (event.currentTarget as HTMLElement).closest('th');
        if (!th) return;
        const startX = event.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const move = (e: MouseEvent) => {
            const width = Math.max(80, Math.round(startWidth + e.clientX - startX));
            setWidths((current) => ({ ...current, [key]: width }));
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            setWidths((current) => { saveLayout({ widths: current }); return current; });
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(pageSize),
                sort: sort.key,
                dir: sort.dir,
            });
            if (applied) params.set('q', applied);
            for (const [key, value] of Object.entries(appliedFilters)) {
                if (value) params.set(`f_${key}`, value);
            }
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
    }, [page, pageSize, applied, appliedFilters, sort]);

    useEffect(() => {
        load();
    }, [load]);

    const pages = Math.max(1, Math.ceil(total / pageSize));
    const filtersOn = Object.values(appliedFilters).some(Boolean) || Boolean(applied);

    const filterInput = (key: keyof Filters, placeholder: string, type: 'text' | 'date' | 'number' = 'text') => (
        <input
            type={type}
            value={filters[key]}
            onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
            placeholder={placeholder}
            className={`w-full border px-1 py-0.5 text-[11px] ${filters[key] ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
        />
    );

    const headerCell = (column: typeof COLUMNS[number], filterCell: React.ReactNode) => (
        <th
            key={column.key}
            className="relative px-4 py-2 align-top font-normal"
            style={widths[column.key] ? { width: widths[column.key], minWidth: widths[column.key] } : undefined}
        >
            <button
                type="button"
                onClick={() => toggleSort(column.key)}
                className={`flex w-full items-center gap-1 ${column.align === 'right' ? 'justify-end' : ''} text-left hover:text-gray-900`}
                title="Упорядочить по этой колонке"
            >
                <span className="min-w-0 truncate">{column.title}</span>
                <span className="shrink-0 text-gray-400">{sort.key === column.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
            </button>
            <div className="mt-1 font-normal">{filterCell}</div>
            {/* Ширину тянут за правый край заголовка — закон §7.0. */}
            <span
                onMouseDown={(e) => startResize(e, column.key)}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-blue-400"
            />
        </th>
    );

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Файлы</h1>
                    <span className="text-xs text-gray-500">{filtersOn ? 'найдено' : 'всего'} {formatIntRu(total)}</span>
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
                    {filtersOn && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery('');
                                setApplied('');
                                setFilters(EMPTY_FILTERS);
                                setAppliedFilters(EMPTY_FILTERS);
                                setPage(1);
                            }}
                            className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-900"
                        >
                            Сбросить всё
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
                    <thead className="sticky top-0 z-10 bg-gray-100 text-left text-gray-600">
                        <tr>
                            {headerCell(COLUMNS[0], filterInput('name', 'часть названия'))}
                            {headerCell(COLUMNS[1], filterInput('order', 'номер'))}
                            {headerCell(COLUMNS[2], (
                                <div className="flex gap-1">
                                    {filterInput('sizeFrom', 'от, КБ', 'number')}
                                    {filterInput('sizeTo', 'до, КБ', 'number')}
                                </div>
                            ))}
                            {headerCell(COLUMNS[3], filterInput('uploadedBy', 'кто'))}
                            {headerCell(COLUMNS[4], (
                                <div className="flex gap-1">
                                    {filterInput('dateFrom', '', 'date')}
                                    {filterInput('dateTo', '', 'date')}
                                </div>
                            ))}
                            {headerCell(COLUMNS[5], filterInput('note', 'часть примечания'))}
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
                    {PAGE_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            onClick={() => {
                                setPageSize(size);
                                setPage(1);
                                saveLayout({ pageSize: size });
                            }}
                            className={`px-2 py-1 font-semibold ${pageSize === size ? 'bg-gray-900 text-white' : 'hover:bg-gray-200'}`}
                        >
                            {size}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            const base = { key: 'at' as SortKey, dir: 'desc' as const };
                            setWidths({});
                            setSort(base);
                            saveLayout({ widths: {}, sort: base });
                        }}
                        className="ml-2 px-2 py-1 font-semibold text-gray-500 hover:text-gray-900"
                    >
                        Сбросить раскладку
                    </button>
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
