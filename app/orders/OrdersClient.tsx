'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import OrdersFilterPanel from '@/components/orders/OrdersFilterPanel';
import OrdersStatusSidebar, { type StatusGroup } from '@/components/orders/OrdersStatusSidebar';
import ViewSettingsModal from '@/components/orders/ViewSettingsModal';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import { EMPTY_FILTER, filterToSearchParams, type OrdersFilter } from '@/lib/orders-filter';
import { ORDER_COLUMNS, DEFAULT_COLUMNS, normalizeSelection } from '@/lib/orders-view';
import StatusIcon from '@/components/orders/StatusIcon';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import CommentCell from '@/components/orders/CommentCell';
import BulkEmailModal from '@/components/orders/BulkEmailModal';
import { useSearchParams } from 'next/navigation';
import { formatRub } from '@/lib/format';

interface OrderRow {
    orderId: number;
    number: string;
    status: string;
    statusLabel: string;
    statusColor: string | null;
    statusIcon: string | null;
    createdAt: string;
    managerName: string | null;
    totalSumm: number | null;
    customerName: string | null;
    contragentName: string | null;
    managerComment: string | null;
    customerComment: string | null;
    itemNames?: string[];
    deliveryCity?: string | null;
    customFields?: Record<string, any>;
    categoryLabel: string | null;
    sferaLabel: string | null;
    phone: string | null;
    email: string | null;
    nextContact: string | null;
    daysInStatus: number | null;
    normDays: number | null;
    overdue: boolean;
    statusSinceApproximate?: boolean;
    items: Array<{ name: string; article: string | null; price: number | null; quantity: number | null }>;
    itemsTotal: number;
}

const money = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—');

/**
 * Цвет текста поверх заливки статуса.
 *
 * Цвета статусов заводит человек, среди них есть и тёмно-красный, и бледно-жёлтый.
 * Один и тот же цвет текста для всех читался бы то плохо, то никак, поэтому
 * считаем яркость фона и берём белый или почти чёрный.
 */
function readableOn(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return '#111827';

    const value = parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Порог высокий: на фирменном оранжевом этапов белый текст читается лучше
    // и выглядит спокойнее — так же, как в RetailCRM.
    return luminance > 0.72 ? '#111827' : '#ffffff';
}

export default function OrdersClient() {
    // Ссылка вида /orders?order=54895 открывает карточку сразу: из плана дня и
    // из «Моего дня» в заказ попадают одним кликом, а не через фильтр списка
    // (требование владельца 01.10.2026).
    const searchParams = useSearchParams();

    const [filter, setFilter] = useState<OrdersFilter>(EMPTY_FILTER);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [statusTree, setStatusTree] = useState<StatusGroup[]>([]);
    const [managers, setManagers] = useState<Array<{ value: string; label: string }>>([]);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1 });
    // Итого по всему фильтру, а не по странице: считает база (orders_filter_totals).
    // sum = null значит «не посчитано» (старая сборка или сбой запроса) — ноль
    // здесь врал бы, а ноль у суммы заказов встречается только по-настоящему.
    const [totals, setTotals] = useState<{ count: number; sum: number | null }>({ count: 0, sum: null });
    const [loading, setLoading] = useState(true);
    // В адресе держим НОМЕР заказа (закон: номер — всегда ссылка), в карточку
    // отдаём идентификатор. У заказов из RetailCRM они совпадают, у своих нет:
    // номер 900043, идентификатор 900000043.
    const [openOrderNumber, setOpenOrderNumber] = useState<string | null>(
        () => (searchParams.get('order') || '').trim() || null,
    );
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);

    /**
     * В ссылке стоит НОМЕР заказа, а не идентификатор карточки. У заказов из
     * RetailCRM они совпадают, у своих — нет: номер 900043, идентификатор
     * 900000043. Пока свои номера были с буквой («1039А»), числовые ссылки
     * открывались напрямую; после перехода на цифры такая ссылка стала вести в
     * пустоту — «Ошибка загрузки» вместо карточки (05.10.2026).
     *
     * Поэтому номер переводим в идентификатор всегда, а числом пользуемся
     * только как запасным вариантом, если заказ с таким номером не нашёлся.
     */
    useEffect(() => {
        const requested = openOrderNumber;
        if (!requested) { setOpenOrderId(null); return; }

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(`/api/orders/list?page=1&pageSize=20&number=${encodeURIComponent(requested)}`);
                const payload = await res.json();
                const found = (payload.rows || payload.orders || []).find(
                    (row: any) => String(row.number) === requested,
                );
                if (cancelled) return;
                if (found?.orderId) { setOpenOrderId(Number(found.orderId)); return; }
            } catch {
                // Молча: список человек увидит в любом случае.
            }
            const asId = Number(requested);
            if (!cancelled && Number.isFinite(asId) && asId > 0) setOpenOrderId(asId);
        })();
        return () => { cancelled = true; };
    }, [openOrderNumber]);

    const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
    /**
     * Реестр колонок приходит с сервера: к постоянным добавлены поля карточки
     * заказа из справочника RetailCRM (решение владельца 05.10.2026).
     */
    /**
     * Выбранные заказы для массовых действий: письмо сразу по нескольким и
     * перенос даты контакта (решение владельца 05.10.2026).
     */
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkOpen, setBulkOpen] = useState(false);

    const [registry, setRegistry] = useState<typeof ORDER_COLUMNS>(ORDER_COLUMNS);
    const registryRef = useRef<typeof ORDER_COLUMNS>(ORDER_COLUMNS);

    /**
     * Порядок строк и ширина колонок — настройки человека, а не экрана: лежат
     * на сервере рядом с набором колонок и переезжают за ним на другой
     * компьютер (закон §7 эталона таблиц, решение владельца 05.10.2026).
     */
    const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
    const [sortable, setSortable] = useState<string[]>([]);
    const [widths, setWidths] = useState<Record<string, number>>({});

    /** Сохраняем раскладку сразу: отдельной кнопки «Сохранить» тут быть не должно. */
    const saveLayout = useCallback((next: { sort?: typeof sort; widths?: Record<string, number> }) => {
        void fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                viewKey: 'orders.layout',
                settings: { sort: next.sort ?? sort, widths: next.widths ?? widths },
            }),
        }).catch(() => undefined);
    }, [sort, widths]);

    /** Щелчок по заголовку: вверх → вниз → снова вверх. */
    const toggleSort = (key: string) => {
        const next: { key: string; dir: 'asc' | 'desc' } = sort.key === key
            ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' };
        setSort(next);
        setPage(1);
        saveLayout({ sort: next });
    };

    /** Тяга за правый край заголовка. Меньше 80 px колонку не делаем — текст пропадёт. */
    const startResize = (event: React.MouseEvent, key: string) => {
        event.preventDefault();
        const th = (event.currentTarget as HTMLElement).parentElement as HTMLElement;
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
    const [columnsOpen, setColumnsOpen] = useState(false);

    useEffect(() => {
        fetch('/api/okk/managers')
            .then((r) => r.json())
            .then((d) => {
                const list = Array.isArray(d) ? d : d.managers || [];
                setManagers(list.map((m: any) => ({
                    value: String(m.id),
                    label: m.name || [m.last_name, m.first_name].filter(Boolean).join(' '),
                })));
            })
            .catch(() => undefined);

        // Сначала реестр, потом выбор: иначе сохранённые поля карточки
        // выкинулись бы как «неизвестные».
        (async () => {
            try {
                const res = await fetch('/api/orders/view-fields');
                const data = await res.json();
                if (Array.isArray(data.columns) && data.columns.length) {
                    registryRef.current = data.columns;
                    setRegistry(data.columns);
                }
            } catch {
                // Реестр не пришёл — остаются постоянные колонки.
            }

            try {
                const res = await fetch('/api/settings/view?viewKey=orders.columns');
                const data = await res.json();
                setColumns(normalizeSelection(data.settings?.items, registryRef.current, DEFAULT_COLUMNS));
            } catch {
                // Выбор не пришёл — остаются колонки по умолчанию.
            }

            try {
                const res = await fetch('/api/settings/view?viewKey=orders.layout');
                const data = await res.json();
                const saved = data.settings ?? {};
                if (saved.sort?.key) setSort({ key: String(saved.sort.key), dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
                if (saved.widths && typeof saved.widths === 'object') setWidths(saved.widths);
            } catch {
                // Раскладка не пришла — порядок и ширины по умолчанию.
            }
        })();
    }, []);

    const saveColumns = async (next: string[]) => {
        setColumns(next);
        setColumnsOpen(false);
        await fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewKey: 'orders.columns', settings: { items: next } }),
        }).catch(() => undefined);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = filterToSearchParams(filter);
            params.set('page', String(page));
            params.set('sort', sort.key);
            params.set('dir', sort.dir);
            const res = await fetch(`/api/orders/list?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось загрузить заказы');
            setOrders(data.orders || []);
            if (Array.isArray(data.sortable)) setSortable(data.sortable);
            setStatusTree(data.statusTree || []);
            setPagination({
                totalCount: data.pagination?.totalCount ?? 0,
                totalPages: data.pagination?.totalPages ?? 1,
            });
            setTotals({
                count: Number(data.totals?.count ?? data.pagination?.totalCount ?? 0),
                sum: data.totals?.sum === undefined || data.totals?.sum === null ? null : Number(data.totals.sum),
            });
        } catch (e) {
            console.error(e);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [filter, page, sort]);

    useEffect(() => { load(); }, [load]);

    // Адрес и открытая карточка не должны расходиться: раньше в строке
    // оставался прежний «?order=28348», а на экране был уже другой заказ —
    // человек видел адрес одного заказа и карточку другого (поймано
    // 02.10.2026). Заодно ссылку на карточку можно просто скопировать.
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        const current = url.searchParams.get('order');
        const next = openOrderNumber;

        if (current === next) return;
        if (next === null) url.searchParams.delete('order');
        else url.searchParams.set('order', next);

        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }, [openOrderNumber]);


    const headerFor = (key: string) => registry.find((c) => c.key === key)?.label ?? key;

    /**
     * Значение поля карточки заказа (`cf.<код>`). Коды в человеческие названия
     * не переводим здесь: справочные поля уже приходят расшифрованными с
     * сервера, остальные — обычный текст.
     */
    const customFieldValue = (order: OrderRow, key: string) => {
        const code = key.slice(3);
        const raw = (order as any).customFields?.[code];
        if (raw === null || raw === undefined || raw === '') return '—';
        if (typeof raw === 'boolean') return raw ? 'Да' : 'Нет';
        return String(raw);
    };

    const cell = (order: OrderRow, key: string) => {
        switch (key) {
            case 'status':
                // Плашка во всю ширину колонки, как в RetailCRM: статусы разной
                // длины иначе дают рваный край и список выглядит хаосом.
                return (
                    <span
                        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-semibold leading-snug"
                        style={{
                            backgroundColor: order.statusColor || '#eef2f7',
                            color: readableOn(order.statusColor || '#eef2f7'),
                        }}
                    >
                        <StatusIcon icon={order.statusIcon} color={readableOn(order.statusColor || '#eef2f7')} />
                        {order.statusLabel}
                    </span>
                );
            case 'number':
                return <OrderNumberLink number={order.number} className="font-bold text-blue-700 hover:underline" />;
            case 'customer':
                return order.customerName || '—';
            case 'contragent':
                return order.contragentName || '—';
            case 'manager':
                return order.managerName || '—';
            case 'managerComment':
                // Свежая запись сверху, остальное по клику: раньше ячейка
                // показывала первые пять строк, а новое лежало внизу.
                return <CommentCell value={order.managerComment} />;
            case 'customerComment':
                return order.customerComment || '—';
            case 'itemNames':
                return order.itemNames?.length
                    ? <span className="whitespace-pre-line text-gray-800">{order.itemNames.join('\n')}</span>
                    : '—';
            case 'deliveryCity':
                return order.deliveryCity || '—';
            case 'category':
                return order.categoryLabel || '—';
            case 'sfera':
                return order.sferaLabel || '—';
            case 'phone':
                return order.phone || '—';
            case 'email':
                return order.email || '—';
            case 'items':
                return order.items.length === 0 ? '—' : (
                    <ul className="list-disc space-y-1 pl-4 text-gray-800">
                        {order.items.map((i, idx) => (
                            <li key={idx}>
                                {i.name}
                                {i.article ? ` ${i.article}` : ''}
                                {i.price != null ? ` — ${i.price.toLocaleString('ru-RU')} ₽` : ''}
                                {i.quantity ? `, ${i.quantity} шт.` : ''}
                            </li>
                        ))}
                        {order.itemsTotal > order.items.length && (
                            <li className="list-none text-gray-600">и ещё {order.itemsTotal - order.items.length}</li>
                        )}
                    </ul>
                );
            case 'totalSumm':
                return <span className="whitespace-nowrap">{money(order.totalSumm)} ₽</span>;
            case 'createdAt':
                return (
                    <span className="whitespace-nowrap">
                        {day(order.createdAt)}
                        <br />
                        <span className="text-gray-600">
                            {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                    </span>
                );
            case 'nextContact':
                return <span className="whitespace-nowrap">{day(order.nextContact)}</span>;
            case 'daysInStatus': {
                if (order.daysInStatus == null) return '—';
                const label = `${order.daysInStatus} дн.`;
                return (
                    <span
                        className={`whitespace-nowrap ${order.overdue ? 'font-semibold text-red-600' : 'text-gray-800'}`}
                        title={
                            order.normDays != null
                                ? `Норматив ${order.normDays} дн.${order.statusSinceApproximate ? ' · отсчёт от создания заказа: смены статуса нет в истории' : ''}`
                                : 'Норматив для этого статуса не задан'
                        }
                    >
                        {label}
                        {order.overdue && order.normDays != null && (
                            <span className="ml-1 text-xs font-normal">из {order.normDays}</span>
                        )}
                    </span>
                );
            }
            default:
                return '—';
        }
    };

    return (
        <div className="flex flex-col bg-white">
            {/* Названия раздела здесь нет: оно уже в шапке (ЗАКАЗЫ), а счётчик —
                в колонке статусов строкой «Все N». Дубль съедал высоту списка
                (закон «один заголовок на экран», golds/GOLD_DESIGN_UX.md). */}

            <OrdersFilterPanel
                value={filter}
                managers={managers}
                statuses={statusTree.flatMap((g) => g.statuses.map((s) => ({ value: s.code, label: s.label })))}
                onApply={(next) => { setFilter(next); setPage(1); }}
            />

            <div className="relative flex border-t border-gray-200">
                <div className="hidden md:block">
                    <OrdersStatusSidebar
                        tree={statusTree}
                        selected={filter.statuses}
                        onSelect={(statuses) => { setFilter({ ...filter, statuses }); setPage(1); }}
                    />
                </div>

                <div className="min-w-0 flex-1 overflow-x-auto">
                    {/* Панель массовых действий: появляется, когда что-то
                        отмечено (решение владельца 05.10.2026). */}
                    {selected.size > 0 && (
                        <div className="mb-2 flex flex-wrap items-center gap-3 border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                            <span className="font-semibold text-gray-900">Выбрано заказов: {selected.size}</span>
                            <button
                                type="button"
                                onClick={() => setBulkOpen(true)}
                                className="bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                                Написать письмо
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelected(new Set())}
                                className="text-xs font-semibold text-blue-700 hover:underline"
                            >
                                снять выделение
                            </button>
                        </div>
                    )}

                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b-2 border-gray-300 bg-gray-100 text-left align-bottom font-bold text-gray-700">
                                {/* Отметка заказа: с неё начинаются массовые действия. */}
                                <th className="w-8 px-2 py-3">
                                    <input
                                        type="checkbox"
                                        checked={orders.length > 0 && orders.every((o) => selected.has(o.number))}
                                        onChange={(e) => setSelected(e.target.checked
                                            ? new Set(orders.map((o) => o.number))
                                            : new Set())}
                                        className="h-4 w-4"
                                        title="Отметить все на странице"
                                    />
                                </th>
                                {columns.map((key, index) => (
                                    <th
                                        key={key}
                                        className="relative px-4 py-3 text-[13px] font-normal"
                                        style={widths[key] ? { width: widths[key], minWidth: widths[key] } : undefined}
                                    >
                                        <span className="flex items-center justify-between gap-2">
                                            {/* Порядок строк — щелчком по заголовку: вверх,
                                                вниз, и снова как было (решение владельца
                                                05.10.2026). Стрелку рисуем только у колонок,
                                                по которым список правда умеет сортировать. */}
                                            {sortable.includes(key) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSort(key)}
                                                    className="flex min-w-0 items-center gap-1 text-left hover:text-gray-900"
                                                    title="Упорядочить по этой колонке"
                                                >
                                                    <span className="min-w-0 truncate">{headerFor(key)}</span>
                                                    <span className="shrink-0 text-gray-400">
                                                        {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                                                    </span>
                                                </button>
                                            ) : (
                                                <span className="min-w-0 truncate">{headerFor(key)}</span>
                                            )}
                                            {/* Настройка колонок живёт в шапке таблицы: своей
                                                строкой она съедала высоту списка
                                                (замечание владельца 02.10.2026). */}
                                            {index === columns.length - 1 && (
                                                <button
                                                    onClick={() => setColumnsOpen(true)}
                                                    title="Настроить колонки"
                                                    aria-label="Настроить колонки"
                                                    className="shrink-0 text-gray-500 hover:text-gray-900"
                                                >
                                                    ⚙
                                                </button>
                                            )}
                                        </span>
                                        {/* Ширину колонки тянут за правый край, как в
                                            RetailCRM. Запоминается за человеком. */}
                                        <span
                                            onMouseDown={(e) => startResize(e, key)}
                                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-blue-400"
                                            title="Потяните, чтобы изменить ширину"
                                        />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-gray-500">Загружаем заказы…</td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-gray-500">Под этот фильтр заказов нет.</td></tr>
                            ) : (
                                orders.map((order) => (
                                    <tr
                                        key={order.orderId}
                                        data-ui-audit="order-row"
                                        onClick={() => setOpenOrderNumber(order.number)}
                                        className={`cursor-pointer border-b border-gray-200 align-top hover:bg-blue-50 ${order.overdue ? 'bg-red-50' : ''}`}
                                    >
                                        <td className="w-8 px-2 py-4" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selected.has(order.number)}
                                                onChange={(e) => setSelected((current) => {
                                                    const next = new Set(current);
                                                    if (e.target.checked) next.add(order.number); else next.delete(order.number);
                                                    return next;
                                                })}
                                                className="h-4 w-4"
                                            />
                                        </td>
                                        {columns.map((key) => (
                                            <td
                                                key={key}
                                                // У статуса плашка во всю ячейку: свои отступы ей не нужны,
                                                // а ширина колонки задана, чтобы плашки были одинаковые.
                                                className={
                                                    key === 'status'
                                                        ? 'w-48 px-2 py-3 text-[13px] leading-relaxed text-gray-900'
                                                        : 'px-4 py-4 text-[13px] leading-relaxed text-gray-900'
                                                }
                                            >
                                                {cell(order, key)}
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Итого под таблицей — по всему фильтру, как в RetailCRM: менеджеру
                нужна сумма отобранных заказов, а не текущей страницы. */}
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-gray-200 bg-gray-50 px-6 py-2 text-sm">
                <span className="text-gray-600">
                    Заказов по фильтру: <b className="text-gray-900">{totals.count.toLocaleString('ru-RU')}</b>
                </span>
                <span className="text-gray-600">
                    Сумма по фильтру:{' '}
                    {totals.sum === null ? (
                        <b className="text-gray-400" title="Сумму считает база; этот ответ её не вернул">—</b>
                    ) : (
                        <b className="text-gray-900">{formatRub(totals.sum)}</b>
                    )}
                </span>
            </div>

            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3">
                    <span className="text-sm text-gray-500">
                        Показано {orders.length} из {pagination.totalCount.toLocaleString('ru-RU')}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="rounded-md border border-gray-400 px-3 py-1.5 text-sm text-gray-800 disabled:text-gray-400"
                        >
                            Назад
                        </button>
                        <span className="text-sm text-gray-700">{page} / {pagination.totalPages}</span>
                        <button
                            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                            disabled={page >= pagination.totalPages}
                            className="rounded-md border border-gray-400 px-3 py-1.5 text-sm text-gray-800 disabled:text-gray-400"
                        >
                            Вперёд
                        </button>
                    </div>
                </div>
            )}

            {columnsOpen && (
                <ViewSettingsModal
                    title="Колонки"
                    registry={registry}
                    selected={columns}
                    defaults={DEFAULT_COLUMNS}
                    onSave={saveColumns}
                    // Сброс раскладки — требование эталона таблиц §7: человек
                    // должен уметь вернуть всё к виду по умолчанию.
                    onResetLayout={() => {
                        const base = { key: 'createdAt', dir: 'desc' as const };
                        setSort(base);
                        setWidths({});
                        saveLayout({ sort: base, widths: {} });
                    }}
                    onClose={() => setColumnsOpen(false)}
                />
            )}

            {/* Закрыли карточку — перечитываем список: иначе в строке остаётся текст,
                который был до правки. Ирина 05.10.2026: вписала комментарий в заказ
                900043, сохранила, вышла — а в колонке по-прежнему висела
                автоподсказка «возможно дубль …». */}
            {bulkOpen && (
                <BulkEmailModal
                    numbers={Array.from(selected)}
                    onClose={() => setBulkOpen(false)}
                    onDone={() => { setSelected(new Set()); void load(); }}
                />
            )}

            {openOrderId !== null && (
                <OrderDetailsModal
                    orderId={openOrderId}
                    isOpen
                    // Пришли из списка писем — карточка сразу открывает ответ
                    // на это письмо (решение владельца 05.10.2026).
                    replyTo={searchParams.get('replyTo')}
                    replySubject={searchParams.get('replySubject')}
                    onClose={() => { setOpenOrderNumber(null); void load(); }}
                />
            )}
        </div>
    );
}
