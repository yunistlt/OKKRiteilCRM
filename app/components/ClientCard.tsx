'use client';

// Карточка клиента: кто это, его реквизиты, связанные карточки того же юрлица
// и все его заказы. Реквизиты в RetailCRM лежат на заказе, поэтому под ними
// подписано, из какого заказа они взяты — число должно раскладываться.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatIntRu, formatRub } from '@/lib/format';
import { isReseller } from '@/lib/own-crm/okved';

type Requisites = {
    contragentType?: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn?: string | null;
    ogrnip?: string | null;
    legalName: string | null;
    legalAddress: string | null;
    bank?: string | null;
    bankAccount?: string | null;
    bik?: string | null;
    corrAccount?: string | null;
    bankAddress?: string | null;
    /** Откуда показаны: карточка клиента, последний заказ или ничего. */
    source?: 'client' | 'order' | 'none';
    fromOrderNumber: string | null;
    updatedAt?: string | null;
    updatedBy?: string | null;
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

type ContactRow = {
    id: number;
    name: string | null;
    phones: string[];
    email: string | null;
    ordersCount: number;
    lastOrderAt: string | null;
};

type CallRow = {
    at: string;
    direction: string;
    durationSec: number | null;
    managerName: string | null;
    orderNumber: string | null;
    missed: boolean;
    hasRecording: boolean;
};

type EmailRow = {
    at: string;
    from: string | null;
    subject: string | null;
    outcome: string;
    orderNumber: string | null;
};

type OrderRow = {
    orderId: number;
    number: string | null;
    statusName: string | null;
    total: number | null;
    createdAt: string | null;
    managerName: string | null;
};

/** Длительность звонка словами: «1 мин 20 с», а не 80. */
function formatDuration(seconds: number | null) {
    if (!seconds) {
        return 'без разговора';
    }
    if (seconds < 60) {
        return `${seconds} с`;
    }
    return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

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
    // Реквизиты правятся здесь: они принадлежат заказчику, а в заказ
    // подтягиваются (решение владельца 02.10.2026).
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Requisites | null>(null);
    const [savingRequisites, setSavingRequisites] = useState(false);
    const [requisitesNote, setRequisitesNote] = useState<string | null>(null);
    const [relation, setRelation] = useState<Relation | null>(null);
    const [related, setRelated] = useState<Related[]>([]);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [calls, setCalls] = useState<CallRow[]>([]);
    const [emails, setEmails] = useState<EmailRow[]>([]);
    const [phone, setPhone] = useState<string | null>(null);
    const [contacts, setContacts] = useState<ContactRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Реквизиты читаем отдельно: их хозяин — клиент, и правятся они здесь.
    const loadRequisites = useCallback(async () => {
        try {
            const res = await fetch(`/api/clients/${clientId}/requisites`);
            const payload = await res.json();
            if (res.ok) setRequisites(payload.requisites);
        } catch {
            // Молча: карточка и без реквизитов полезна, а ошибку покажем при правке.
        }
    }, [clientId]);

    const saveRequisites = async () => {
        if (!draft) return;
        setSavingRequisites(true);
        setRequisitesNote(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/requisites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    legalName: draft.legalName ?? '',
                    inn: draft.inn ?? '',
                    kpp: draft.kpp ?? '',
                    ogrn: draft.ogrn ?? '',
                    ogrnip: draft.ogrnip ?? '',
                    legalAddress: draft.legalAddress ?? '',
                    bank: draft.bank ?? '',
                    bankAccount: draft.bankAccount ?? '',
                    bik: draft.bik ?? '',
                    corrAccount: draft.corrAccount ?? '',
                    bankAddress: draft.bankAddress ?? '',
                    contragentType: draft.contragentType ?? '',
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить реквизиты');
            setRequisites(payload.requisites);
            void loadRequisites();
            setEditing(false);
            setDraft(null);
        } catch (e: any) {
            setRequisitesNote(e.message);
        } finally {
            setSavingRequisites(false);
        }
    };

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
            setCalls(payload.calls || []);
            setEmails(payload.emails || []);
            setPhone(payload.phone || null);
            setContacts(payload.contacts || []);
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
                    <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        <span>Реквизиты</span>
                        {editing ? (
                            <span className="flex items-center gap-2">
                                <button
                                    onClick={saveRequisites}
                                    disabled={savingRequisites}
                                    className="text-[11px] font-bold normal-case text-blue-700 hover:underline disabled:text-gray-400"
                                >
                                    {savingRequisites ? 'Сохраняем…' : 'Сохранить'}
                                </button>
                                <button
                                    onClick={() => { setEditing(false); setDraft(null); }}
                                    className="text-[11px] font-bold normal-case text-gray-500 hover:underline"
                                >
                                    Отменить
                                </button>
                            </span>
                        ) : (
                            <button
                                onClick={() => { setDraft({ ...(requisites ?? {}) } as Requisites); setEditing(true); }}
                                className="text-[11px] font-bold normal-case text-blue-700 hover:underline"
                            >
                                Править
                            </button>
                        )}
                    </div>

                    {editing && draft ? (
                        <div className="divide-y divide-gray-100">
                            {([
                                ['legalName', 'Юридическое название'],
                                ['inn', 'ИНН'],
                                ['kpp', 'КПП'],
                                ['ogrn', 'ОГРН'],
                                ['ogrnip', 'ОГРНИП'],
                                ['legalAddress', 'Юридический адрес'],
                                ['bank', 'Банк'],
                                ['bankAccount', 'Расчётный счёт'],
                                ['bik', 'БИК'],
                                ['corrAccount', 'Корреспондентский счёт'],
                                ['bankAddress', 'Адрес банка'],
                            ] as Array<[keyof Requisites, string]>).map(([key, label]) => (
                                <label key={String(key)} className="flex items-center gap-2 px-4 py-1.5">
                                    <span className="w-40 shrink-0 text-gray-500">{label}</span>
                                    <input
                                        value={String(draft[key] ?? '')}
                                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                                        className="w-full border border-gray-300 px-2 py-1"
                                    />
                                </label>
                            ))}
                        </div>
                    ) : (
                        <>
                            <Field label="Юридическое название" value={requisites?.legalName} />
                            <Field label="ИНН" value={requisites?.inn} />
                            <Field label="КПП" value={requisites?.kpp} />
                            <Field label="ОГРН / ОГРНИП" value={requisites?.ogrn || requisites?.ogrnip} />
                            <Field label="Юридический адрес" value={requisites?.legalAddress} />
                            <Field label="Банк" value={requisites?.bank} />
                            <Field label="Расчётный счёт" value={requisites?.bankAccount} />
                            <Field label="БИК" value={requisites?.bik} />
                            <Field label="Корреспондентский счёт" value={requisites?.corrAccount} />
                        </>
                    )}

                    {requisitesNote && (
                        <div className="px-4 py-2 text-[11px] text-amber-800">{requisitesNote}</div>
                    )}
                    {!editing && requisites?.source === 'order' && requisites?.fromOrderNumber && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Показаны из заказа №{requisites.fromOrderNumber} — в карточке их ещё нет.
                            Нажмите «Править» и сохраните: дальше они будут подтягиваться в каждый новый заказ.
                        </div>
                    )}
                    {!editing && requisites?.source === 'client' && requisites?.updatedAt && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Обновлены {new Date(requisites.updatedAt).toLocaleDateString('ru-RU')}
                            {requisites.updatedBy ? ` · ${requisites.updatedBy}` : ''}
                        </div>
                    )}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Контактные лица
                    </div>
                    {contacts.length === 0 && (
                        <>
                            <div className="px-4 py-3 text-gray-500">Контактных лиц не нашли — показываем связь из заказа.</div>
                            <Field label="Телефон" value={phone} />
                            <Field label="Почта" value={client?.email || client?.contact_email} />
                        </>
                    )}
                    {contacts.map((person) => (
                        <div key={person.id} className="border-b border-gray-100 px-4 py-3">
                            <div className="font-semibold text-gray-900">{person.name || 'Без имени'}</div>
                            <div className="text-[11px] text-gray-500">
                                {person.phones[0] || 'телефон неизвестен'}
                                {person.email ? ` · ${person.email}` : ''}
                            </div>
                            <div className="text-[11px] text-gray-500">
                                заказов с ним: {formatIntRu(person.ordersCount)}
                                {person.lastOrderAt ? ` · последний ${new Date(person.lastOrderAt).toLocaleDateString('ru-RU')}` : ''}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-white text-xs">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        О компании
                    </div>
                    {!relation && (
                        <div className="px-4 py-3 text-gray-500">
                            {requisites?.inn
                                ? `Данные из ЕГРЮЛ по ИНН ${requisites.inn} ещё не собирали — они подтягиваются по клиентам отдела продаж.`
                                : 'Данных о компании нет: они подтягиваются по ИНН, а он у клиента неизвестен.'}
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

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Звонки
                    </div>
                    {calls.length === 0 && (
                        <div className="px-4 py-3 text-gray-500">
                            Звонков не нашли. Они связываются с клиентом через номера его заказов — звонок без номера заказа сюда не попадёт.
                        </div>
                    )}
                    {calls.map((call, index) => (
                        <div key={`${call.at}-${index}`} className="border-b border-gray-100 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-gray-900">
                                    {call.direction}
                                    {call.missed && <span className="ml-2 text-red-600">пропущен</span>}
                                </span>
                                <span className="text-gray-500">{formatDuration(call.durationSec)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {new Date(call.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {call.managerName ? ` · ${call.managerName}` : ''}
                                {call.orderNumber ? ` · заказ №${call.orderNumber}` : ''}
                                {call.hasRecording ? ' · есть запись' : ''}
                            </div>
                        </div>
                    ))}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Письма
                    </div>
                    {emails.length === 0 && <div className="px-4 py-3 text-gray-500">Писем от этого адреса нет.</div>}
                    {emails.map((mail, index) => (
                        <div key={`${mail.at}-${index}`} className="border-b border-gray-100 px-4 py-3">
                            <div className="text-gray-900">{mail.subject || 'Без темы'}</div>
                            <div className="text-[11px] text-gray-500">
                                {new Date(mail.at).toLocaleDateString('ru-RU')} · {mail.outcome}
                                {mail.orderNumber ? ` · заказ №${mail.orderNumber}` : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
