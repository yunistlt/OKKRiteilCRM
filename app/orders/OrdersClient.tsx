'use client';

import { useCallback, useEffect, useState } from 'react';
import OrdersFilterPanel from '@/components/orders/OrdersFilterPanel';
import OrdersStatusSidebar, { type StatusGroup } from '@/components/orders/OrdersStatusSidebar';
import ViewSettingsModal from '@/components/orders/ViewSettingsModal';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import { EMPTY_FILTER, filterToSearchParams, type OrdersFilter } from '@/lib/orders-filter';
import { ORDER_COLUMNS, DEFAULT_COLUMNS, normalizeSelection } from '@/lib/orders-view';

interface OrderRow {
    orderId: number;
    number: string;
    status: string;
    statusLabel: string;
    statusColor: string | null;
    createdAt: string;
    managerName: string | null;
    totalSumm: number | null;
    customerName: string | null;
    contragentName: string | null;
    managerComment: string | null;
    customerComment: string | null;
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

export default function OrdersClient() {
    const [filter, setFilter] = useState<OrdersFilter>(EMPTY_FILTER);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [statusTree, setStatusTree] = useState<StatusGroup[]>([]);
    const [managers, setManagers] = useState<Array<{ value: string; label: string }>>([]);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);

    const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
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

        fetch('/api/settings/view?viewKey=orders.columns')
            .then((r) => r.json())
            .then((d) => setColumns(normalizeSelection(d.settings?.items, ORDER_COLUMNS, DEFAULT_COLUMNS)))
            .catch(() => undefined);
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
            const res = await fetch(`/api/orders/list?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось загрузить заказы');
            setOrders(data.orders || []);
            setStatusTree(data.statusTree || []);
            setPagination({
                totalCount: data.pagination?.totalCount ?? 0,
                totalPages: data.pagination?.totalPages ?? 1,
            });
        } catch (e) {
            console.error(e);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [filter, page]);

    useEffect(() => { load(); }, [load]);

    const headerFor = (key: string) => ORDER_COLUMNS.find((c) => c.key === key)?.label ?? key;

    const cell = (order: OrderRow, key: string) => {
        switch (key) {
            case 'status':
                return (
                    <span
                        className="inline-block rounded px-2 py-1 text-xs font-medium text-gray-800"
                        style={{ backgroundColor: order.statusColor || '#eef2f7' }}
                    >
                        {order.statusLabel}
                    </span>
                );
            case 'number':
                return <span className="font-medium text-blue-600">{order.number}</span>;
            case 'customer':
                return order.customerName || '—';
            case 'contragent':
                return order.contragentName || '—';
            case 'manager':
                return order.managerName || '—';
            case 'managerComment':
                return order.managerComment
                    ? <span className="whitespace-pre-line text-gray-700">{order.managerComment.split('\n').slice(0, 5).join('\n')}</span>
                    : '—';
            case 'customerComment':
                return order.customerComment || '—';
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
                    <ul className="list-disc space-y-1 pl-4 text-gray-700">
                        {order.items.map((i, idx) => (
                            <li key={idx}>
                                {i.name}
                                {i.article ? ` ${i.article}` : ''}
                                {i.price != null ? ` — ${i.price.toLocaleString('ru-RU')} ₽` : ''}
                                {i.quantity ? `, ${i.quantity} шт.` : ''}
                            </li>
                        ))}
                        {order.itemsTotal > order.items.length && (
                            <li className="list-none text-gray-400">и ещё {order.itemsTotal - order.items.length}</li>
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
                        <span className="text-gray-500">
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
                        className={`whitespace-nowrap ${order.overdue ? 'font-semibold text-red-600' : 'text-gray-700'}`}
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
        <div className="flex h-full min-h-0 flex-col bg-white">
            <div className="flex items-baseline gap-3 px-6 pb-2 pt-5">
                <h1 className="text-2xl font-semibold text-gray-900">Заказы</h1>
                <span className="text-sm text-gray-400">
                    {loading ? 'загружаем…' : `${pagination.totalCount.toLocaleString('ru-RU')}`}
                </span>
            </div>

            <OrdersFilterPanel
                value={filter}
                managers={managers}
                statuses={statusTree.flatMap((g) => g.statuses.map((s) => ({ value: s.code, label: s.label })))}
                onApply={(next) => { setFilter(next); setPage(1); }}
            />

            <div className="relative flex min-h-0 flex-1 border-t border-gray-200">
                <div className="hidden md:block">
                    <OrdersStatusSidebar
                        tree={statusTree}
                        selected={filter.statuses}
                        onSelect={(statuses) => { setFilter({ ...filter, statuses }); setPage(1); }}
                    />
                </div>

                <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <div className="flex justify-end px-4 pt-2">
                        <button
                            onClick={() => setColumnsOpen(true)}
                            title="Настроить колонки"
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-400 text-white hover:bg-gray-500"
                        >
                            ⚙
                        </button>
                    </div>

                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 bg-gray-50 text-left align-bottom text-gray-500">
                                {columns.map((key) => (
                                    <th key={key} className="px-4 py-3 text-[13px] font-normal">
                                        {headerFor(key)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={columns.length} className="px-4 py-8 text-gray-500">Загружаем заказы…</td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={columns.length} className="px-4 py-8 text-gray-500">Под этот фильтр заказов нет.</td></tr>
                            ) : (
                                orders.map((order) => (
                                    <tr
                                        key={order.orderId}
                                        onClick={() => setOpenOrderId(order.orderId)}
                                        className={`cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/40 ${order.overdue ? 'bg-red-50/50' : ''}`}
                                    >
                                        {columns.map((key) => (
                                            <td key={key} className="px-4 py-4 text-[13px] leading-relaxed text-gray-800">
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

            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3">
                    <span className="text-sm text-gray-500">
                        Показано {orders.length} из {pagination.totalCount.toLocaleString('ru-RU')}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:text-gray-300"
                        >
                            Назад
                        </button>
                        <span className="text-sm text-gray-500">{page} / {pagination.totalPages}</span>
                        <button
                            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                            disabled={page >= pagination.totalPages}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:text-gray-300"
                        >
                            Вперёд
                        </button>
                    </div>
                </div>
            )}

            {columnsOpen && (
                <ViewSettingsModal
                    title="Колонки"
                    registry={ORDER_COLUMNS}
                    selected={columns}
                    defaults={DEFAULT_COLUMNS}
                    onSave={saveColumns}
                    onClose={() => setColumnsOpen(false)}
                />
            )}

            {openOrderId !== null && (
                <OrderDetailsModal orderId={openOrderId} isOpen onClose={() => setOpenOrderId(null)} />
            )}
        </div>
    );
}
