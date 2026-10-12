'use client';

// Все файлы заказов одним списком по золотому стандарту таблиц
// (golds/GOLD_UI_TABLES.md): поиск, фильтр по каждой колонке, порядок строк,
// состав и порядок колонок, ширина, масштаб и сохранённые наборы фильтров.
// Всё это запоминается за человеком на сервере и переезжает с ним на любой
// компьютер.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import ViewSettingsModal from '@/components/orders/ViewSettingsModal';
import { orderFileHref } from '@/lib/orders/file-href';
import { formatIntRu } from '@/lib/format';
import type { ViewItem } from '@/lib/orders-view';

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
    archivedAt: string | null;
    archivedBy: string | null;
    lost?: boolean;
};

type ColumnKey = 'name' | 'order' | 'size' | 'uploadedBy' | 'at' | 'note';

const COLUMN_TITLES: Record<ColumnKey, string> = {
    name: 'Файл',
    order: 'Заказ',
    size: 'Размер',
    uploadedBy: 'Приложил',
    at: 'Когда',
    note: 'Примечание',
};

/** Реестр для окна «Колонки»: что можно показать и что снять нельзя. */
const COLUMN_REGISTRY: ViewItem[] = [
    { key: 'name', label: 'Файл', group: 'Основное', locked: true },
    { key: 'order', label: 'Заказ', group: 'Основное', locked: true },
    { key: 'size', label: 'Размер', group: 'Основное' },
    { key: 'uploadedBy', label: 'Приложил', group: 'Кто и когда' },
    { key: 'at', label: 'Когда', group: 'Кто и когда' },
    { key: 'note', label: 'Примечание', group: 'Основное' },
];

const DEFAULT_COLUMNS: ColumnKey[] = ['name', 'order', 'size', 'uploadedBy', 'at', 'note'];

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

/** Сохранённый набор фильтров — «вкладка» над таблицей (золото §6). */
type Preset = { name: string; filters: Filters; query: string };

const VIEW_KEY = 'files.layout';
const PAGE_SIZES = [20, 50, 100];
const ZOOM_MIN = 50;
const ZOOM_MAX = 130;
const ZOOM_STEP = 10;

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
    const [sort, setSort] = useState<{ key: ColumnKey; dir: 'asc' | 'desc' }>({ key: 'at', dir: 'desc' });
    const [widths, setWidths] = useState<Record<string, number>>({});
    const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [zoom, setZoom] = useState(100);
    const [presets, setPresets] = useState<Preset[]>([]);
    const [activePreset, setActivePreset] = useState<string | null>(null);
    /** Быстрый просмотр: строка открывается сбоку, список под ней остаётся. */
    const [preview, setPreview] = useState<FileRow | null>(null);
    /** Архив — по переключателю: удалять файлы нельзя, их только архивируют. */
    const [archive, setArchive] = useState(false);
    const [dragKey, setDragKey] = useState<ColumnKey | null>(null);
    const [overKey, setOverKey] = useState<ColumnKey | null>(null);
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

    // Раскладка — за человеком на сервере, закон §7.
    useEffect(() => {
        fetch(`/api/settings/view?viewKey=${VIEW_KEY}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((payload) => {
                const saved = payload?.settings;
                if (!saved) return;
                if (saved.widths && typeof saved.widths === 'object') setWidths(saved.widths);
                if (saved.sort?.key) setSort({ key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
                if (PAGE_SIZES.includes(Number(saved.pageSize))) setPageSize(Number(saved.pageSize));
                if (Array.isArray(saved.columns) && saved.columns.length) {
                    const known = saved.columns.filter((key: string): key is ColumnKey => key in COLUMN_TITLES);
                    if (known.length) setColumns(known);
                }
                if (Number.isFinite(Number(saved.zoom))) setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(saved.zoom))));
                if (Array.isArray(saved.presets)) setPresets(saved.presets);
            })
            .catch(() => undefined);
    }, []);

    type Layout = {
        widths?: Record<string, number>;
        sort?: { key: ColumnKey; dir: 'asc' | 'desc' };
        pageSize?: number;
        columns?: ColumnKey[];
        zoom?: number;
        presets?: Preset[];
    };

    const saveLayout = useCallback((next: Layout) => {
        fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                viewKey: VIEW_KEY,
                settings: {
                    widths: next.widths ?? widths,
                    sort: next.sort ?? sort,
                    pageSize: next.pageSize ?? pageSize,
                    columns: next.columns ?? columns,
                    zoom: next.zoom ?? zoom,
                    presets: next.presets ?? presets,
                },
            }),
        }).catch(() => undefined);
    }, [widths, sort, pageSize, columns, zoom, presets]);

    const toggleSort = (key: ColumnKey) => {
        const next: { key: ColumnKey; dir: 'asc' | 'desc' } = sort.key === key
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

    /** Перетащили заголовок — колонка встала на место того, над которым отпустили. */
    const dropColumn = (target: ColumnKey) => {
        if (!dragKey || dragKey === target) { setDragKey(null); setOverKey(null); return; }
        const next = columns.filter((key) => key !== dragKey);
        next.splice(next.indexOf(target), 0, dragKey);
        setColumns(next);
        saveLayout({ columns: next });
        setDragKey(null);
        setOverKey(null);
    };

    const changeZoom = useCallback((value: number) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
        setZoom(next);
        saveLayout({ zoom: next });
    }, [saveLayout]);

    // Ctrl/Cmd + «=» / «−» / «0» — как в Google Таблицах; системный зум перехватываем.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key === '=' || e.key === '+') { e.preventDefault(); changeZoom(zoom + ZOOM_STEP); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); changeZoom(zoom - ZOOM_STEP); }
            else if (e.key === '0') { e.preventDefault(); changeZoom(100); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [zoom, changeZoom]);

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
            if (archive) params.set('archive', '1');
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
    }, [page, pageSize, applied, appliedFilters, sort, archive]);

    useEffect(() => {
        load();
    }, [load]);

    const pages = Math.max(1, Math.ceil(total / pageSize));
    const filtersOn = Object.values(appliedFilters).some(Boolean) || Boolean(applied);

    const resetAll = () => {
        setQuery('');
        setApplied('');
        setFilters(EMPTY_FILTERS);
        setAppliedFilters(EMPTY_FILTERS);
        setActivePreset(null);
        setPage(1);
    };

    const applyPreset = (preset: Preset) => {
        setFilters(preset.filters);
        setAppliedFilters(preset.filters);
        setQuery(preset.query);
        setApplied(preset.query);
        setActivePreset(preset.name);
        setPage(1);
    };

    const savePreset = () => {
        const name = window.prompt('Как назвать этот набор отборов?')?.trim();
        if (!name) return;
        const next = [...presets.filter((p) => p.name !== name), { name, filters, query }];
        setPresets(next);
        setActivePreset(name);
        saveLayout({ presets: next });
    };

    const removePreset = (name: string) => {
        const next = presets.filter((p) => p.name !== name);
        setPresets(next);
        if (activePreset === name) setActivePreset(null);
        saveLayout({ presets: next });
    };

    const filterInput = (key: keyof Filters, placeholder: string, type: 'text' | 'date' | 'number' = 'text') => (
        <input
            type={type}
            value={filters[key]}
            onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
            placeholder={placeholder}
            className={`w-full border px-1 py-0.5 text-[11px] ${filters[key] ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
        />
    );

    /** Поле (или пара полей) отбора под заголовком конкретной колонки. */
    const filterFor = (key: ColumnKey) => {
        if (key === 'name') return filterInput('name', 'часть названия');
        if (key === 'order') return filterInput('order', 'номер');
        if (key === 'uploadedBy') return filterInput('uploadedBy', 'кто');
        if (key === 'note') return filterInput('note', 'часть примечания');
        if (key === 'size') {
            return (
                <div className="flex gap-1">
                    {filterInput('sizeFrom', 'от, КБ', 'number')}
                    {filterInput('sizeTo', 'до, КБ', 'number')}
                </div>
            );
        }
        return (
            <div className="flex gap-1">
                {filterInput('dateFrom', '', 'date')}
                {filterInput('dateTo', '', 'date')}
            </div>
        );
    };

    const columnFiltered = (key: ColumnKey) => {
        if (key === 'size') return Boolean(appliedFilters.sizeFrom || appliedFilters.sizeTo);
        if (key === 'at') return Boolean(appliedFilters.dateFrom || appliedFilters.dateTo);
        return Boolean(appliedFilters[key as keyof Filters]);
    };

    const cell = (key: ColumnKey, row: FileRow) => {
        if (key === 'name') {
            if (row.lost) {
                return (
                    <>
                        <span className="font-semibold text-gray-400 line-through">{row.name}</span>
                        <span className="ml-2 border border-red-200 bg-red-50 px-1 py-0.5 text-[10px] font-semibold text-red-700">файл стёрт до 12.10.2026</span>
                    </>
                );
            }
            return (
                <>
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
                    {row.archivedAt && (
                        <span className="ml-2 border border-gray-300 px-1 py-0.5 text-[10px] font-semibold text-gray-500">в архиве</span>
                    )}
                </>
            );
        }
        if (key === 'order') return <OrderNumberLink number={row.orderNumber} />;
        if (key === 'size') return formatSize(row.size);
        if (key === 'uploadedBy') return row.uploadedBy || <span className="text-gray-300">—</span>;
        if (key === 'at') return formatMoment(row.at);
        return row.note || <span className="text-gray-300">—</span>;
    };

    const visible = useMemo(() => columns.filter((key) => key in COLUMN_TITLES), [columns]);

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Файлы</h1>
                    <span className="text-xs text-gray-500">{filtersOn ? 'найдено' : 'всего'} {formatIntRu(total)}</span>
                    {/* Файлы не удаляются — только уходят в архив (закон владельца
                        12.10.2026). Здесь их видно и отсюда они открываются. */}
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input
                            type="checkbox"
                            checked={archive}
                            onChange={(e) => { setArchive(e.target.checked); setPage(1); }}
                            className="h-3.5 w-3.5"
                        />
                        показать архивные
                    </label>
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
                        <>
                            <button
                                type="button"
                                onClick={savePreset}
                                className="px-2 py-1 text-xs font-semibold text-blue-700 hover:underline"
                                title="Запомнить этот набор отборов вкладкой"
                            >
                                Сохранить отбор
                            </button>
                            <button type="button" onClick={resetAll} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-900">
                                Сбросить всё
                            </button>
                        </>
                    )}
                    {/* Масштаб таблицы — золото §6. */}
                    <span className="ml-2 flex items-center border border-gray-300 text-xs">
                        <button type="button" onClick={() => changeZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="px-2 py-1 font-semibold disabled:text-gray-300 hover:bg-gray-200">−</button>
                        <button type="button" onClick={() => changeZoom(100)} className="px-1 py-1 tabular-nums" title="Вернуть 100%">{zoom}%</button>
                        <button type="button" onClick={() => changeZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="px-2 py-1 font-semibold disabled:text-gray-300 hover:bg-gray-200">+</button>
                    </span>
                </form>
            </div>

            {/* Сохранённые наборы отборов — вкладками над таблицей. */}
            {presets.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1">
                    {presets.map((preset) => (
                        <span
                            key={preset.name}
                            className={`flex items-center border text-xs ${activePreset === preset.name ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
                        >
                            <button type="button" onClick={() => applyPreset(preset)} className="px-2 py-1 font-semibold">{preset.name}</button>
                            <button type="button" onClick={() => removePreset(preset.name)} title="Убрать набор" className="px-1 py-1 opacity-60 hover:opacity-100">×</button>
                        </span>
                    ))}
                </div>
            )}

            {/* Закон «заглушки видны»: честно говорим, чего в списке нет. */}
            <div className="mb-2 text-[11px] text-gray-500">
                Здесь файлы, приложенные к заказам. Вложения писем у нас не хранятся — они открываются из переписки в карточке заказа.
            </div>

            {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            <div className="min-h-0 flex-1 overflow-auto bg-white">
                {/* Масштаб вешаем на саму таблицу: иначе ломается прилипшая шапка. */}
                <table className="min-w-full text-xs" style={{ zoom: `${zoom}%` }}>
                    <thead className="sticky top-0 z-10 bg-gray-100 text-left text-gray-600">
                        <tr>
                            {visible.map((key, index) => (
                                <th
                                    key={key}
                                    draggable
                                    onDragStart={() => setDragKey(key)}
                                    onDragOver={(e) => { e.preventDefault(); setOverKey(key); }}
                                    onDrop={() => dropColumn(key)}
                                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                                    className={`relative cursor-move px-4 py-2 align-top font-normal ${overKey === key && dragKey && dragKey !== key ? 'border-l-2 border-blue-500' : ''}`}
                                    style={widths[key] ? { width: widths[key], minWidth: widths[key] } : undefined}
                                >
                                    <span className="flex items-start justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => toggleSort(key)}
                                            className={`flex min-w-0 items-center gap-1 ${key === 'size' ? 'justify-end' : ''} text-left hover:text-gray-900`}
                                            title="Упорядочить по этой колонке"
                                        >
                                            <span className="min-w-0 truncate">{COLUMN_TITLES[key]}</span>
                                            <span className="shrink-0 text-gray-400">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                                            {/* Отбор по колонке применён — видно по значку. */}
                                            {columnFiltered(key) && <span className="shrink-0 text-blue-600">⦿</span>}
                                        </button>
                                        {index === visible.length - 1 && (
                                            <button
                                                type="button"
                                                onClick={() => setColumnsOpen(true)}
                                                title="Настроить колонки"
                                                aria-label="Настроить колонки"
                                                className="shrink-0 text-gray-500 hover:text-gray-900"
                                            >
                                                ⚙
                                            </button>
                                        )}
                                    </span>
                                    <div className="mt-1 font-normal">{filterFor(key)}</div>
                                    {/* Ширину тянут за правый край заголовка — закон §7.0. */}
                                    <span
                                        onMouseDown={(e) => startResize(e, key)}
                                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-blue-400"
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={visible.length} className="px-4 py-6 text-center text-gray-500">Загружаю…</td></tr>
                        )}
                        {!loading && rows.length === 0 && (
                            <tr><td colSpan={visible.length} className="px-4 py-6 text-center text-gray-500">Ничего не нашлось</td></tr>
                        )}
                        {!loading && rows.map((row, index) => (
                            <tr
                                key={row.id}
                                onClick={(e) => {
                                    // Щелчок по ссылке — это ссылка, а не просмотр.
                                    if ((e.target as HTMLElement).closest('a')) return;
                                    setPreview(row);
                                }}
                                className={`cursor-pointer border-b border-gray-100 hover:bg-amber-50 ${preview?.id === row.id ? 'bg-amber-100' : index % 2 ? 'bg-gray-50' : ''}`}
                            >
                                {visible.map((key) => (
                                    <td key={key} className={`px-4 py-3 ${key === 'size' ? 'text-right' : ''} ${key === 'name' || key === 'order' ? '' : 'text-gray-600'}`}>
                                        {cell(key, row)}
                                    </td>
                                ))}
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

            {preview && (
                <FilePreview
                    file={preview}
                    onClose={() => setPreview(null)}
                    onRestored={() => { setPreview(null); load(); }}
                />
            )}

            {columnsOpen && (
                <ViewSettingsModal
                    title="Колонки"
                    registry={COLUMN_REGISTRY}
                    selected={columns}
                    defaults={DEFAULT_COLUMNS}
                    onSave={(next) => {
                        const known = next.filter((key): key is ColumnKey => key in COLUMN_TITLES);
                        setColumns(known);
                        saveLayout({ columns: known });
                        setColumnsOpen(false);
                    }}
                    onResetLayout={() => {
                        const base = { key: 'at' as ColumnKey, dir: 'desc' as const };
                        setSort(base);
                        setWidths({});
                        setColumns(DEFAULT_COLUMNS);
                        setZoom(100);
                        saveLayout({ sort: base, widths: {}, columns: DEFAULT_COLUMNS, zoom: 100 });
                    }}
                    onClose={() => setColumnsOpen(false)}
                />
            )}
        </div>
    );
}

/**
 * Быстрый просмотр — боковая панель вместо ухода со страницы (золото §6).
 *
 * Список с отбором и страницей остаётся на месте: человек смотрит файл,
 * закрывает панель и продолжает с того же места.
 */
function FilePreview({ file, onClose, onRestored }: { file: FileRow; onClose: () => void; onRestored: () => void }) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    /** Вернуть файл из архива в заказ — обратная дверь к кнопке «в архив». */
    const restore = async () => {
        setBusy(true);
        setProblem(null);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(file.orderNumber)}/files/upload?fileId=${file.id}`, { method: 'PATCH' });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось вернуть файл');
            onRestored();
        } catch (e: any) {
            setProblem(e.message);
        } finally {
            setBusy(false);
        }
    };

    const href = orderFileHref({ orderNumber: file.orderNumber, fileId: file.id });
    const type = (file.contentType || '').toLowerCase();
    const isImage = type.startsWith('image/');
    const isPdf = type.includes('pdf');

    // Закрываем клавишей Esc — как все наши окна.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const row = (label: string, value: React.ReactNode) => (
        <div className="flex gap-2 border-b border-gray-100 py-1.5">
            <span className="w-28 shrink-0 text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
            <span className="min-w-0 break-words text-gray-900">{value}</span>
        </div>
    );

    return (
        <aside className="fixed right-0 top-0 z-[120] flex h-screen w-[460px] max-w-full flex-col border-l border-gray-300 bg-white text-xs shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-100 px-4 py-3">
                <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">Файл</div>
                    <div className="break-words text-sm font-semibold text-gray-900">{file.name}</div>
                </div>
                <button type="button" onClick={onClose} aria-label="Закрыть" className="px-2 text-xl leading-none text-gray-400 hover:text-gray-900">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <div className="border-b border-gray-200 bg-gray-50 p-3">
                    {isImage && <img src={href} alt={file.name} className="max-h-[340px] w-full object-contain" />}
                    {isPdf && <iframe src={href} title={file.name} className="h-[340px] w-full border border-gray-200 bg-white" />}
                    {!isImage && !isPdf && (
                        <div className="py-8 text-center text-gray-500">
                            Такой файл показать прямо здесь нельзя — откройте его кнопкой ниже.
                        </div>
                    )}
                </div>

                <div className="p-4">
                    {row('Заказ', <OrderNumberLink number={file.orderNumber} />)}
                    {row('Размер', formatSize(file.size))}
                    {row('Тип', file.contentType || <span className="text-gray-300">—</span>)}
                    {row('Приложил', file.uploadedBy || <span className="text-gray-300">—</span>)}
                    {row('Когда', formatMoment(file.at))}
                    {row('Примечание', file.note || <span className="text-gray-300">—</span>)}
                    {row('В производство', file.forProduction ? 'да' : 'нет')}
                    {file.archivedAt && row('В архиве с', `${formatMoment(file.archivedAt)}${file.archivedBy ? ` · ${file.archivedBy}` : ''}`)}
                </div>
            </div>

            {problem && <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-red-700">{problem}</div>}

            <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3">
                <a href={href} target="_blank" rel="noreferrer" className="bg-gray-900 px-3 py-1 font-semibold text-white hover:bg-gray-700">
                    Открыть файл
                </a>
                {file.archivedAt && !file.lost && (
                    <button
                        type="button"
                        onClick={restore}
                        disabled={busy}
                        className="border border-gray-900 px-3 py-1 font-semibold text-gray-900 hover:bg-gray-100 disabled:border-gray-300 disabled:text-gray-400"
                    >
                        {busy ? 'Возвращаю…' : 'Вернуть из архива'}
                    </button>
                )}
                <a href={href} download={file.name} className="border border-gray-300 px-3 py-1 font-semibold text-gray-700 hover:bg-gray-100">
                    Скачать
                </a>
                <a href={`/orders?order=${encodeURIComponent(file.orderNumber)}`} className="ml-auto font-semibold text-blue-700 hover:underline">
                    Перейти в заказ →
                </a>
            </div>
        </aside>
    );
}
