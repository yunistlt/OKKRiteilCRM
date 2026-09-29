'use client';

// Карточка клиента: кто это, его реквизиты, связанные карточки того же юрлица
// и все его заказы. Реквизиты в RetailCRM лежат на заказе, поэтому под ними
// подписано, из какого заказа они взяты — число должно раскладываться.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatIntRu, formatRub } from '@/lib/format';
import { isReseller } from '@/lib/own-crm/okved';

type Requisites = {
    inn: string | null;
    kpp: string | null;
    legalName: string | null;
    legalAddress: string | null;
    fromOrderNumber: string | null;
};

type Relation = {
    stage: string | null;
    okved_code: string | null;
    activity: string | null;
    region: string | null;
    company_status: string | null;
    branches: number | null;
    potential: string | number | null;
    next_contact_at: string | null;
    last_touch_at: string | null;
};

type Related = {
    customerId: string;
    name: string | null;
    ordersCount: number | null;
    totalSumm: number | null;
    reason: string;
};

type OrderRow = {
    orderId: number;
    number: string | null;
    statusName: string | null;
    total: number | null;
    createdAt: string | null;
    managerName: string | null;
};

function Dash() {
    return <span className="text-gray-300">—</span>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    // Пустое значение показываем прочерком, а не пустотой: по эталону пустая
    // ячейка читается как «забыли показать», а прочерк — как «данных нет».
    const empty = value === null || value === undefined || value === '';

    return (
        <div className="border-b border-gray-100 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
            <div className="text-gray-900">{empty ? <Dash /> : value}</div>
        </div>
    );
}

export default function ClientCard({ clientId }: { clientId: string }) {
    const router = useRouter();
    const [client, setClient] = useState<any>(null);
    const [requisites, setRequisites] = useState<Requisites | null>(null);
    const [relation, setRelation] = useState<Relation | null>(null);
    const [related, setRelated] = useState<Related[]>([]);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/clients/${clientId}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось открыть карточку клиента');
            setClient(payload.client);
            setRequisites(payload.requisites);
            setRelation(payload.relation || null);
            setRelated(payload.related || []);
            setOrders(payload.orders || []);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        load();
    }, [load]);

    if (loading) {
        return <div className="min-h-screen bg-gray-50 p-4 text-xs text-gray-500">Загружаю…</div>;
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 p-4">
                <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
                <a href="/clients" className="mt-3 inline-block text-xs font-semibold text-gray-500 hover:text-gray-900">← К списку клиентов</a>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">{client?.company_name || 'Клиент без названия'}</h1>
                    <a href="/clients" className="text-xs font-semibold text-gray-500 hover:text-gray-900">← К списку клиентов</a>
                </div>
                <div className="flex gap-px bg-gray-200 text-xs">
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Заказов</div>
                        <div className="font-semibold text-gray-900">{formatIntRu(client?.orders_count || 0)}</div>
                    </div>
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Купил на</div>
                        <div className="font-semibold text-gray-900">{formatRub(client?.total_summ || 0)}</div>
                    </div>
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Средний чек</div>
                        <div className="font-semibold text-gray-900">{formatRub(client?.average_check || 0)}</div>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-gray-200 lg:grid-cols-3">
                <div className="bg-white text-xs">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Реквизиты
                    </div>
                    <Field label="Юридическое название" value={requisites?.legalName} />
                    <Field label="ИНН" value={requisites?.inn} />
                    <Field label="КПП" value={requisites?.kpp} />
                    <Field label="Юридический адрес" value={requisites?.legalAddress} />
                    {requisites?.fromOrderNumber && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Реквизиты взяты из заказа №{requisites.fromOrderNumber}: в RetailCRM они хранятся на заказе, а не в карточке клиента.
                        </div>
                    )}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Связь
                    </div>
                    <Field label="Контактное лицо" value={client?.contact_name} />
                    <Field label="Телефон" value={client?.phones?.[0]} />
                    <Field label="Почта" value={client?.email || client?.contact_email} />
                </div>

                <div className="bg-white text-xs">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        О компании
                    </div>
                    {!relation && (
                        <div className="px-4 py-3 text-gray-500">
                            Данных о компании нет: они подтягиваются по ИНН из ЕГРЮЛ, а ИНН у клиента неизвестен.
                        </div>
                    )}
                    {relation && (
                        <>
                            <Field label="Чем занимается" value={relation.activity} />
                            <Field label="Регион" value={relation.region} />
                            <Field label="Состояние" value={relation.company_status} />
                            <Field label="Филиалов" value={relation.branches ? formatIntRu(relation.branches) : null} />
                            <Field
                                label="Роль в сделке"
                                value={isReseller(relation.okved_code)
                                    ? 'Скорее посредник — основной вид деятельности торговля'
                                    : 'Скорее конечный заказчик'}
                            />
                            <Field label="Следующий контакт" value={relation.next_contact_at ? new Date(relation.next_contact_at).toLocaleDateString('ru-RU') : null} />
                        </>
                    )}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Карточки того же юрлица
                    </div>
                    {related.length === 0 && (
                        <div className="px-4 py-3 text-gray-500">Других карточек не нашли.</div>
                    )}
                    {related.map((item) => (
                        <button
                            key={item.customerId}
                            onClick={() => router.push(`/clients/${item.customerId}`)}
                            className="block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-amber-50"
                        >
                            <div className="font-semibold text-gray-900">{item.name || 'Без названия'}</div>
                            <div className="text-[11px] text-gray-500">
                                {formatIntRu(item.ordersCount || 0)} заказов на {formatRub(item.totalSumm || 0)} · связь по: {item.reason}
                            </div>
                        </button>
                    ))}
                    {related.length > 0 && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Карточки не объединяются автоматически — решение за менеджером.
                        </div>
                    )}
                </div>

                <div className="bg-white text-xs lg:col-span-1">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Заказы
                    </div>
                    {orders.length === 0 && <div className="px-4 py-3 text-gray-500">Заказов нет.</div>}
                    {orders.map((order) => (
                        <div key={order.orderId} className="border-b border-gray-100 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="font-semibold text-gray-900">№{order.number}</span>
                                <span className="text-gray-900">{order.total ? formatRub(order.total) : <Dash />}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {order.statusName || <Dash />}
                                {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString('ru-RU')}` : ''}
                                {order.managerName ? ` · ${order.managerName}` : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
