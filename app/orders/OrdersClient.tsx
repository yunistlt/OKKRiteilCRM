'use client';

import { useCallback, useEffect, useState } from 'react';
import OrdersFilterPanel from '@/components/orders/OrdersFilterPanel';
import OrdersStatusSidebar, { type StatusGroup } from '@/components/orders/OrdersStatusSidebar';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import { EMPTY_FILTER, filterToSearchParams, type OrdersFilter } from '@/lib/orders-filter';

interface OrderRow {
    orderId: number;
    number: string;
    status: string;
    statusLabel: string;
    createdAt: string;
    managerName: string | null;
    totalSumm: number | null;
    customerName: string | null;
    managerComment: string | null;
    nextContact: string | null;
    items: Array<{ name: string; quantity: number | null }>;
    itemsTotal: number;
}

export default function OrdersClient() {
    const [filter, setFilter] = useState<OrdersFilter>(EMPTY_FILTER);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [statusTree, setStatusTree] = useState<StatusGroup[]>([]);
    const [managers, setManagers] = useState<Array<{ value: string; label: string }>>([]);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);

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
    }, []);

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

    const money = (v: number | null) =>
        v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-baseline justify-between border-b border-gray-200 bg-white px-4 py-3">
                <h1 className="text-xl font-black text-gray-900">Заказы</h1>
                <span className="text-xs text-gray-500">
                    {loading ? 'Загружаем…' : `${pagination.totalCount.toLocaleString('ru-RU')} заказов под фильтром`}
                </span>
            </div>

            <OrdersFilterPanel
                value={filter}
                managers={managers}
                statuses={statusTree.flatMap((g) => g.statuses.map((s) => ({ value: s.code, label: s.label })))}
                onApply={(next) => { setFilter(next); setPage(1); }}
            />

            <div className="flex min-h-0 flex-1">
                <div className="hidden md:block">
                    <OrdersStatusSidebar
                        tree={statusTree}
                        selected={filter.statuses}
                        onSelect={(statuses) => { setFilter({ ...filter, statuses }); setPage(1); }}
                    />
                </div>

                <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="border-b-2 border-gray-900 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
                                <th className="px-3 py-2">Статус</th>
                                <th className="px-3 py-2">Номер</th>
                                <th className="px-3 py-2">Клиент</th>
                                <th className="px-3 py-2">Менеджер</th>
                                <th className="px-3 py-2">Комментарий оператора</th>
                                <th className="px-3 py-2">Состав</th>
                                <th className="px-3 py-2 text-right">Сумма</th>
                                <th className="px-3 py-2">Оформлен</th>
                                <th className="px-3 py-2">След. контакт</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={9} className="px-3 py-6 text-sm text-gray-500">Загружаем заказы…</td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={9} className="px-3 py-6 text-sm text-gray-500">Под этот фильтр заказов нет.</td></tr>
                            ) : (
                                orders.map((o) => (
                                    <tr
                                        key={o.orderId}
                                        onClick={() => setOpenOrderId(o.orderId)}
                                        className="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50"
                                    >
                                        <td className="px-3 py-2">
                                            <span className="bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">{o.statusLabel}</span>
                                        </td>
                                        <td className="px-3 py-2 font-bold text-blue-700">{o.number}</td>
                                        <td className="px-3 py-2 text-gray-900">{o.customerName || '—'}</td>
                                        <td className="px-3 py-2 text-gray-700">{o.managerName || '—'}</td>
                                        <td className="max-w-[280px] px-3 py-2 text-xs text-gray-600">
                                            {o.managerComment ? o.managerComment.split('\n').slice(0, 3).join(' · ') : '—'}
                                        </td>
                                        <td className="max-w-[280px] px-3 py-2 text-xs text-gray-600">
                                            {o.items.length === 0 ? '—' : (
                                                <>
                                                    {o.items.map((i, idx) => (
                                                        <div key={idx}>{i.name}{i.quantity ? ` — ${i.quantity} шт.` : ''}</div>
                                                    ))}
                                                    {o.itemsTotal > o.items.length && (
                                                        <div className="text-gray-400">и ещё {o.itemsTotal - o.items.length}</div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-gray-900">{money(o.totalSumm)}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                                            {o.createdAt ? new Date(o.createdAt).toLocaleDateString('ru-RU') : '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                                            {o.nextContact ? new Date(o.nextContact).toLocaleDateString('ru-RU') : '—'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-2">
                    <span className="text-xs text-gray-500">
                        Показано {orders.length} из {pagination.totalCount.toLocaleString('ru-RU')}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="border border-gray-300 px-3 py-1 text-xs font-bold disabled:text-gray-300"
                        >
                            Назад
                        </button>
                        <span className="px-2 text-xs text-gray-600">{page} / {pagination.totalPages}</span>
                        <button
                            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                            disabled={page >= pagination.totalPages}
                            className="border border-gray-300 px-3 py-1 text-xs font-bold disabled:text-gray-300"
                        >
                            Вперёд
                        </button>
                    </div>
                </div>
            )}

            {openOrderId !== null && (
                <OrderDetailsModal
                    orderId={openOrderId}
                    isOpen
                    onClose={() => setOpenOrderId(null)}
                />
            )}
        </div>
    );
}
