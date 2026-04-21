'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { checkCounterpartyByInn, CounterpartyScoreResult } from '@/lib/legal-counterparty-check';
import CallInitiator from './calls/CallInitiator';
import { isVisibleBreakdownKey } from '@/lib/okk-consultant';
import { formatQualityCriterionLabel } from '@/lib/quality-labels';

interface OrderDetailsModalProps {
    orderId: number;
    isOpen: boolean;
    onClose: () => void;
}

interface OrderDetails {
    order: any;
    calls: any[];
    emails: any[];
    history: any[];
    priority?: any;
    insights?: any;
    raw_payload: any;
}

interface InfoFieldProps {
    label: string;
    value?: ReactNode;
    required?: boolean;
}

const viewTabs = [
    { id: 'card', label: 'Карточка заказа' },
    { id: 'quality', label: 'Качество заявки' }
] as const;

const sectionNavItems = [
    { id: 'order-common', label: 'Основное' },
    { id: 'order-customer', label: 'Клиент' },
    { id: 'order-list', label: 'Состав заказа' },
    { id: 'order-delivery', label: 'Отгрузка и доставка' },
    { id: 'order-payment', label: 'Оплата' },
    { id: 'order-custom-fields', label: 'Доп. данные' }
] as const;

type ViewTab = typeof viewTabs[number]['id'];
type QualityMobileTab = 'calls' | 'transcript' | 'analysis';
type ScoreBreakdownEntry = {
    result?: boolean | null;
    reason?: string | null;
    reason_human?: string | null;
    rule_id?: string | null;
    source_refs?: string[];
    source_values?: Record<string, any> | null;
    calculation_steps?: string[];
    confidence?: number | null;
    missing_data?: string[];
    recommended_fix?: string | null;
};

const InfoField = ({ label, value, required }: InfoFieldProps) => (
    <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            {label}
            {required && <span className="text-red-500">*</span>}
        </div>
        <div className="px-3 py-2 rounded-lg border text-sm bg-gray-50 border-gray-200 text-gray-900">
            {value ?? <span className="text-gray-400">Не указано</span>}
        </div>
    </div>
);

const statusLabels: Record<string, string> = {
    'novyi-1': 'Новый',
    work: 'В работе',
    'otmenyon-klientom': 'Отменён клиентом',
    'otmenyon-postavschikom': 'Отменён поставщиком',
    'zayavka-kvalifitsirovana': 'Заявка квалифицирована',
    'already-buyed': 'Сделка завершена',
    finished: 'Завершён'
};

const pickValue = (...values: any[]) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        return value;
    }
    return null;
};

const formatCountryName = (iso?: string | null) => {
    if (!iso) return 'Россия';
    const upper = iso.toUpperCase();
    const dictionary: Record<string, string> = {
        RU: 'Россия',
        KZ: 'Казахстан',
        BY: 'Беларусь',
        UA: 'Украина'
    };
    return dictionary[upper] || upper;
};

const formatBooleanYesNo = (value?: boolean | null) => (value ? 'Да' : 'Нет');

const extractItemPrice = (item: any) => {
    const price = pickValue(item?.prices?.[0]?.price, item?.initialPrice, item?.price);
    if (price === null) return 0;
    return typeof price === 'number' ? price : Number(price) || 0;
};

const extractItemQuantity = (item: any) => {
    const quantity = pickValue(item?.prices?.[0]?.quantity, item?.quantity, item?.qty, 1);
    if (quantity === null) return 1;
    return typeof quantity === 'number' ? quantity : Number(quantity) || 1;
};

const toNumber = (value: any) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const parsed = Number((value as string).toString().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
};

const toArray = (value: any) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
};

    const [data, setData] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [counterpartyScore, setCounterpartyScore] = useState<CounterpartyScoreResult | null>(null);
    const [counterpartyScoreLoading, setCounterpartyScoreLoading] = useState(false);
    const [viewTab, setViewTab] = useState<ViewTab>('card');
    const [qualityCalls, setQualityCalls] = useState<any[]>([]);
    const [qualityScore, setQualityScore] = useState<any | null>(null);
    const [qualityCallsLoading, setQualityCallsLoading] = useState(false);
    const [qualityScoreLoading, setQualityScoreLoading] = useState(false);
    const [qualityError, setQualityError] = useState<string | null>(null);
    const [selectedCallIndex, setSelectedCallIndex] = useState(0);
    const [qualityMobileTab, setQualityMobileTab] = useState<QualityMobileTab>('calls');
    const [transcribing, setTranscribing] = useState(false);
    const [qualityFetched, setQualityFetched] = useState(false);

    const fetchQualityScore = useCallback(async () => {
        if (!orderId) return;
        setQualityScoreLoading(true);
        try {
            const res = await fetch(`/api/okk/scores/${orderId}`);
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error || 'Не удалось загрузить оценку');
            }
            setQualityScore(json.order || json.score || null);
        } catch (e: any) {
            console.error(e);
            setQualityError(e.message || 'Не удалось загрузить качество');
        } finally {
            setQualityScoreLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        if (isOpen && orderId) {
            fetchDetails();
            fetchQualityScore(); // Fetch score immediately on open for the header
            setViewTab('card');
            setQualityCalls([]);
            setQualityError(null);
            setSelectedCallIndex(0);
            setQualityMobileTab('calls');
            setQualityFetched(false);
            setTranscribing(false);
            setCounterpartyScore(null);
        }
    }, [isOpen, orderId, fetchQualityScore]);

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/details`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);
            // Проверка контрагента по ИНН
            const inn = json?.order?.inn || json?.raw_payload?.inn || json?.order?.customer_inn;
            if (inn) {
                setCounterpartyScoreLoading(true);
                try {
                    const resp = await fetch('/api/legal/counterparty/score', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ inn })
                    });
                    if (resp.ok) {
                        const score = await resp.json();
                        setCounterpartyScore(score);
                    }
                } catch {}
                setCounterpartyScoreLoading(false);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchQualityCalls = useCallback(async () => {
        if (!orderId) return;
        setQualityCallsLoading(true);
        try {
            const res = await fetch(`/api/okk/scores/${orderId}/calls`);
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error || 'Не удалось загрузить звонки');
            }
            const calls = Array.isArray(json.calls) ? json.calls : [];
            setQualityCalls(calls);
            if (calls.length > 0) {
                const firstWithTranscript = calls.findIndex((call: any) => Boolean(call.transcript));
                setSelectedCallIndex(firstWithTranscript >= 0 ? firstWithTranscript : 0);
            } else {
                setSelectedCallIndex(0);
            }
            setQualityMobileTab('calls');
        } catch (e: any) {
            console.error(e);
            setQualityError(e.message || 'Не удалось загрузить качество');
        } finally {
            setQualityCallsLoading(false);
        }
    }, [orderId]);

    const loadQualityData = useCallback(async () => {
        setQualityError(null);
        await Promise.allSettled([fetchQualityCalls()]);
        setQualityFetched(true);
    }, [fetchQualityCalls]);

    const handleQualityRefresh = useCallback(() => {
        setQualityFetched(false);
    }, []);

    const handleTranscribeCall = useCallback(async () => {
        const activeCall = qualityCalls[selectedCallIndex];
        if (!activeCall?.recording_url || !activeCall?.telphin_call_id || transcribing) return;
        setTranscribing(true);
        try {
            const res = await fetch('/api/okk/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callId: activeCall.telphin_call_id,
                    recordingUrl: activeCall.recording_url
                })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || 'Ошибка при транскрибации');
            }
            await fetchQualityCalls();
            setQualityMobileTab('transcript');
        } catch (e: any) {
            alert(`Ошибка транскрибации: ${e.message || 'неизвестная ошибка'}`);
        } finally {
            setTranscribing(false);
        }
    }, [qualityCalls, selectedCallIndex, transcribing, fetchQualityCalls]);

    useEffect(() => {
        if (!isOpen || viewTab !== 'quality' || !orderId) return;
        if (qualityFetched) return;
        loadQualityData();
    }, [isOpen, viewTab, orderId, qualityFetched, loadQualityData]);

    const headerPayload = data?.raw_payload ?? null;
    const headerContact = headerPayload?.contact ?? {};
    const headerCustomer = headerPayload?.customer ?? {};
    const headerCustomFields = (headerPayload?.customFields ?? {}) as Record<string, any>;
    const statusCode = data?.order?.status || headerPayload?.status || headerPayload?.status?.code;
    const statusLabel = statusCode ? statusLabels[statusCode] || statusCode : null;
    const headerBadges = (
        [
            headerCustomer?.vip || headerContact?.vip
                ? { label: 'VIP', className: 'bg-purple-100 text-purple-700' }
                : null,
            headerCustomer?.bad || headerContact?.bad
                ? { label: 'BAD', className: 'bg-red-100 text-red-700' }
                : null,
            headerCustomFields?.control
                ? { label: 'Контроль', className: 'bg-amber-100 text-amber-700' }
                : null,
            statusLabel
                ? { label: statusLabel, className: 'bg-blue-100 text-blue-700' }
                : null
        ].filter(Boolean) as { label: string; className: string }[]
    );

    if (!isOpen) return null;

    const formatCurrency = (value?: number | null) => {
        if (value === null || value === undefined) return '—';
        return value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
    };

    const formatDate = (value?: string | null) => {
        if (!value) return '—';
        return new Date(value).toLocaleDateString('ru-RU');
    };

    const formatDateTime = (value?: string | null) => {
        if (!value) return '—';
        return new Date(value).toLocaleString('ru-RU');
    };

    const renderCardContent = () => {
        if (!data) return null;

        const order = data.order ?? {};
        const payload = data.raw_payload ?? {};
        const delivery = payload.delivery ?? {};
        const shipping = delivery.shipping ?? {};
        const address = delivery.address ?? {};
        const contact = payload.contact ?? {};
        const customer = payload.customer ?? {};
        const customFields = (payload.customFields ?? {}) as Record<string, any>;
        const paymentSource = payload.payments ?? order.payments ?? {};
        const paymentEntries = toArray(paymentSource);
        const contactPhones = (Array.isArray(contact.phones) ? contact.phones.map((p: any) => p.number).filter(Boolean) : []) as string[];
        const storedPhones = (Array.isArray(order.customer_phones) ? order.customer_phones : []) as string[];
        const normalizedPhones = [
            payload.phone, 
            order.phone, 
            ...(Array.isArray(contactPhones) ? contactPhones : []), 
            ...(Array.isArray(storedPhones) ? storedPhones : [])
        ].filter(Boolean);
        const [primaryPhone, secondaryPhone, thirdPhone] = normalizedPhones;
        const segments = Array.isArray(contact.segments) ? contact.segments.map((segment: any) => segment.name).filter(Boolean).join(', ') : null;
        const companyName = pickValue(customer.nickName, customer.companyName, customer.name);
        const productCategory = pickValue(customFields.typ_castomer, customFields.tovarnaya_kategoriya, customFields.product_category, payload.category);
        const nextContact = pickValue(customFields.data_kontakta, customFields.next_contact_date, customFields.follow_up_date);
        const cancelDate = pickValue(payload.cancelledAt, customFields.data_otmeny);
        const purchaseForm = pickValue(customFields.typ_customer_margin, customFields.purchase_form, customFields.forma_zakupki);
        const sphere = pickValue(customFields.sfera_deiatelnosti, customFields.sfera_deyatelnosti, customFields.sphere_of_activity) || payload.industry;
        const invoiceValidDays = pickValue(customFields.schiot_deistvitelen_v_techenie_dnei);
        const docFlow = customFields.dokumentooborot_cherez_edo;
        const documentsViaEDO = formatBooleanYesNo(docFlow);
        const timezoneCode = pickValue(customFields.chasovoi_poias, customFields.timezone);
        const timezoneMap: Record<string, string> = {
            zero_0: 'МСК (UTC+0)',
            plus_3: 'UTC+3',
            minus_3: 'UTC-3'
        };
        const timezoneValue = timezoneCode ? (timezoneMap[timezoneCode] || timezoneCode) : null;
        const logisticDeadline = pickValue(customFields.srok_izgot, shipping.productionDays, delivery.productionDays);
        const logisticComment = pickValue(customFields.komment_diveleri, shipping.comment, delivery.comment);
        const logisticWarehouse = pickValue(customFields.sklad_otgruzki, shipping.warehouse);
        const logisticNeedBy = pickValue(customFields.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo);
        const logisticBuyerType = pickValue(customFields.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete);
        const logisticReceiver = pickValue(customFields.naimenovanie_gruzopoluchatelya);
        const roistat = pickValue(customFields.roistat, payload.roistat);
        const dsDocument = pickValue(customFields.datacheta);
        const marginValue = pickValue(customFields.marzha);
        const expectedAmountValue = toNumber(pickValue(customFields.ozhidaemaya_summa, customFields.expected_amount, payload.totalSumm));
        const priorityNumber = pickValue(customFields.prioriry_number);
        const contractBasis = pickValue(customFields.osnovanie_podpиси);
        const changeManager = pickValue(customFields.change_name_manager);
        const planPurchaseDate = pickValue(customFields.purchase_date, customFields.plan_purchase_date, payload.purchaseDate);
        const logisticAddress = pickValue(address.text, [address.region, address.city, address.street, address.house, address.building].filter(Boolean).join(', '));
        const logisticIndex = pickValue(address.index);
        const logisticMetro = pickValue(address.metro);
        const logisticCity = pickValue(address.city);
        const logisticRegion = pickValue(address.region);
        const logisticCost = toNumber(pickValue(delivery.cost, order.delivery_cost));
        const logisticSelfCost = toNumber(pickValue(delivery.selfCost, customFields.sebestoimost2));
        const logisticDate = pickValue(delivery.date, customFields.data_otgruzki);
        const logisticTime = pickValue(delivery.time, customFields.vremya_dostavki);
        const operatorComment = pickValue(payload.managerComment);
        const clientComment = pickValue(payload.customerComment);
        const additionalEmail = pickValue(customFields.additional_email, customFields.dopolnitelnyi_email, payload.additionalEmail);
        const totalSummValue = toNumber(pickValue(payload.totalSumm, order.totalsumm));
        const orderStatusCode = pickValue(payload.status?.code, payload.status, order.status);
        const countryValue = formatCountryName(pickValue(payload.countryIso, address.countryIso));
        const createdDate = formatDateTime(pickValue(payload.createdAt, order.created_at));
        const statusUpdated = formatDateTime(pickValue(payload.statusUpdatedAt, order.updated_at));
        const privilegeType = pickValue(payload.privilegeType);
        const contactName = [contact.lastName, contact.firstName, contact.patronymic].filter(Boolean).join(' ').trim() || pickValue(payload.firstName, payload.lastName);
        const expectedDelivery = pickValue(customFields.when_need_delivery, customFields.plan_delivery_date);
        const paymentsSummary = paymentEntries.length > 0 ? paymentEntries : [];
        const items = Array.isArray(payload.items) ? payload.items : toArray(order.items);
        const computedItemsTotal = items.reduce((sum: number, item: any) => {
            const price = extractItemPrice(item);
            const qty = extractItemQuantity(item);
            return sum + price * qty;
        }, 0);

        return (
            <div className="space-y-12">
                <section id="order-common" className="space-y-6">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Основное</h3>
                            <span className="text-xs uppercase font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                                {orderStatusCode ? statusLabels[orderStatusCode] || orderStatusCode : 'Статус не задан'}
                            </span>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <InfoField label="Страна" required value={countryValue} />
                            <InfoField label="Тип заказа" value={payload.orderType || 'Не указан'} />
                            <InfoField label="Менеджер" value={order.manager_name || changeManager || 'Не назначен'} />
                            <InfoField label="Магазин" required value={payload.site || order.site || payload.slug || '—'} />
                            <InfoField label="Способ оформления" value={payload.orderMethod || payload.orderMethodName || 'Не указан'} />
                            <InfoField label="Дата поступления" value={createdDate} />
                            <InfoField label="Обновлён" value={statusUpdated} />
                            <InfoField label="Привилегия" value={privilegeType || '—'} />
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Контроль</h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            <InfoField label="Категория товара" required value={productCategory || '—'} />
                            <InfoField label="Дата следующего контакта" value={formatDate(nextContact)} />
                            <InfoField label="Дата отмены" value={formatDate(cancelDate)} />
                            <InfoField label="Сегмент клиента" value={segments || '—'} />
                            <InfoField label="Форма закупки" value={purchaseForm || 'Требуется уточнить'} />
                            <InfoField label="Сегмент покупателя" value={sphere || 'Требуется уточнить'} />
                            <InfoField label="VIP" value={formatBooleanYesNo(contact.vip || customer.vip)} />
                            <InfoField label="BAD" value={formatBooleanYesNo(contact.bad || customer.bad)} />
                            <InfoField label="Сумма" value={formatCurrency(totalSummValue)} />
                            <InfoField label="Ожидаемая сумма" value={expectedAmountValue !== null ? formatCurrency(expectedAmountValue) : '—'} />
                            <InfoField label="Документооборот через ЭДО" value={documentsViaEDO} />
                            <InfoField label="Счёт действителен (дней)" value={invoiceValidDays || '—'} />
                        </div>
                    </div>
                </section>

                <section id="order-customer" className="space-y-6">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Клиент</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                            <InfoField label="Тип клиента" value={customer.type === 'customer_corporate' ? 'Юридическое лицо' : 'Клиент'} />
                            <InfoField label="Компания" value={companyName || '—'} />
                            <InfoField label="Контакт" value={contactName || '—'} />
                            <InfoField label="Email" value={payload.email || contact.email || customer.email || '—'} />
                            <InfoField label="Основной телефон" value={primaryPhone || '—'} />
                            <InfoField label="Доп. телефон (2)" value={secondaryPhone || '—'} />
                            <InfoField label="Доп. телефон (3)" value={thirdPhone || '—'} />
                            <InfoField label="Доп. Email" value={additionalEmail || '—'} />
                            <InfoField label="Диалоги" value={payload.dialogsCount ? `${payload.dialogsCount} открыто` : 'Нет открытых диалогов'} />
                            <InfoField label="Партнёр" value={customer.partner || '—'} />
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <div className="grid md:grid-cols-2 gap-4">
                            <InfoField label="Должность" value={customFields.dolzhnost || payload.position || '—'} />
                            <InfoField label="Сегмент клиента" value={segments || '—'} />
                            <InfoField label="Сфера деятельности" required value={sphere || 'Требуется уточнить'} />
                            <InfoField label="Часовой пояс" value={timezoneValue || '—'} />
                            <InfoField label="Документооборот" value={documentsViaEDO} />
                            <InfoField label="Основание подписи" value={contractBasis || '—'} />
                            <InfoField label="Когда нужно оборудование" value={logisticNeedBy || '—'} />
                            <InfoField label="Для кого закупка" value={logisticBuyerType || '—'} />
                            <InfoField label="Адрес фактический" value={logisticAddress || '—'} />
                            <InfoField label="Комментарий клиента" value={clientComment || '—'} />
                        </div>
                    </div>
                </section>

                <section id="order-list">
                    <div className="bg-white border border-gray-200 rounded-xl p-0 overflow-hidden shadow-sm">
                        <div className="p-6 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">Состав заказа</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3 text-left">№</th>
                                        <th className="px-4 py-3 text-left">Товар / услуга</th>
                                        <th className="px-4 py-3 text-left">Свойства</th>
                                        <th className="px-4 py-3 text-left">Артикул</th>
                                        <th className="px-4 py-3 text-left">Статус</th>
                                        <th className="px-4 py-3 text-left">Кол-во</th>
                                        <th className="px-4 py-3 text-left">Цена</th>
                                        <th className="px-4 py-3 text-left">Стоимость</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {items.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="text-center py-10 text-gray-500">
                                                В заказе нет позиций. Добавьте их в Retail CRM, чтобы увидеть здесь.
                                            </td>
                                        </tr>
                                    ) : (
                                        items.map((item: any, index: number) => {
                                            const price = extractItemPrice(item);
                                            const qty = extractItemQuantity(item);
                                            const cost = price * qty;
                                            const sku = pickValue(item.sku, item.article, item.offer?.article, item.offer?.externalId);
                                            const properties = [...toArray(item.offer?.properties), ...toArray(item.properties)]
                                                .map((prop: any) => prop.name || prop.value)
                                                .filter(Boolean)
                                                .join(', ');
                                            return (
                                                <tr key={item.id || index} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3">{index + 1}</td>
                                                    <td className="px-4 py-3 font-semibold text-gray-900">{item.offer?.displayName || item.name || item.title}</td>
                                                    <td className="px-4 py-3 text-gray-500">{properties || '—'}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-500">{sku || '—'}</td>
                                                    <td className="px-4 py-3 text-gray-500">{item.status || '—'}</td>
                                                    <td className="px-4 py-3">{qty}</td>
                                                    <td className="px-4 py-3">{formatCurrency(price)}</td>
                                                    <td className="px-4 py-3 font-semibold">{formatCurrency(cost)}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-6 px-6 py-4 bg-gray-50 border-t text-sm text-gray-600">
                            <div>Стоимость товаров: {formatCurrency(totalSummValue || computedItemsTotal)}</div>
                            <div>Стоимость доставки: {formatCurrency(logisticCost)}</div>
                            <div>Себестоимость: {formatCurrency(logisticSelfCost)}</div>
                            <div className="font-semibold text-gray-900">Итого: {formatCurrency((totalSummValue || 0) + (logisticCost || 0))}</div>
                        </div>
                    </div>
                </section>

                <section id="order-delivery" className="space-y-6">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-semibold rounded-full">Склад</span>
                            <h3 className="text-lg font-semibold text-gray-900">Отгрузка и доставка</h3>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                            <InfoField label="Склад отгрузки" value={logisticWarehouse || 'Не указан'} />
                            <InfoField label="Дата отгрузки" value={formatDate(shipping.date || logisticDate)} />
                            <InfoField label="Платное хранение" value={formatBooleanYesNo(shipping.paidStorage)} />
                            <InfoField label="Срок изготовления (дни)" value={logisticDeadline || '—'} />
                            <InfoField label="Комментарий логисту" value={logisticComment || '—'} />
                            <InfoField label="Склад / адрес" value={shipping.address || logisticAddress || '—'} />
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <div className="grid md:grid-cols-2 gap-4">
                            <InfoField label="Тип доставки" value={delivery.code || delivery.type || 'Не указан'} />
                            <InfoField label="Дата доставки" value={formatDate(delivery.date || expectedDelivery)} />
                            <InfoField label="Время доставки" value={logisticTime || '—'} />
                            <InfoField label="Стоимость" value={formatCurrency(logisticCost)} />
                            <InfoField label="Себестоимость" value={formatCurrency(logisticSelfCost)} />
                            <InfoField label="Регион" value={logisticRegion || '—'} />
                            <InfoField label="Город" value={logisticCity || '—'} />
                            <InfoField label="Метро" value={logisticMetro || '—'} />
                            <InfoField label="Индекс" value={logisticIndex || '—'} />
                            <InfoField label="Адрес" value={logisticAddress || '—'} />
                            <InfoField label="Получатель" value={logisticReceiver || '—'} />
                            <InfoField label="Коммент клиента" value={delivery.comment || '—'} />
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-6">
                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Комментарии клиента</h4>
                            <div className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 border border-gray-100 rounded-lg p-4 min-h-[120px]">
                                {clientComment || 'Комментариев нет.'}
                            </div>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Комментарии оператора</h4>
                            <div className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 border border-gray-100 rounded-lg p-4 min-h-[120px]">
                                {operatorComment || 'Комментариев нет.'}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-xs uppercase text-gray-400">Коммуникации</p>
                                <h4 className="text-lg font-semibold text-gray-900">Письма и сообщения</h4>
                            </div>
                            <button className="px-3 py-2 text-sm font-medium border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                                + Новое письмо
                            </button>
                        </div>
                        {data.emails && data.emails.length > 0 ? (
                            <div className="space-y-3">
                                {data.emails.map((email) => (
                                    <div key={email.id || email.date} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                                        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                                            <span>{email.date ? new Date(email.date).toLocaleString('ru-RU') : 'Без даты'}</span>
                                            <span className="px-2 py-0.5 bg-gray-100 rounded-full uppercase font-semibold">{email.type}</span>
                                        </div>
                                        <p className="text-sm text-gray-800 whitespace-pre-line">{email.text}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">Писем по заказу ещё нет.</p>
                        )}
                    </div>
                </section>

                <section id="order-payment" className="space-y-6">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Оплата</h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            <InfoField label="Сумма заказа" value={formatCurrency(totalSummValue)} />
                            <InfoField label="Предоплата" value={formatCurrency(toNumber(payload.prepaySum))} />
                            <InfoField label="Ожидается" value={formatCurrency(toNumber(payload.purchaseSumm))} />
                            <InfoField label="Статус оплаты" value={payload.payment?.status || 'Не указан'} />
                            <InfoField label="Дата оплаты" value={formatDate(payload.payment?.date)} />
                            <InfoField label="Комментарий" value={payload.payment?.comment || '—'} />
                            <InfoField label="Приоритет" value={priorityNumber || '—'} />
                            <InfoField label="Roistat" value={roistat || '—'} />
                            <InfoField label="Дата передачи в производство" value={formatDate(customFields.data_peredachi_v_proizvodstvo || payload.productionDate)} />
                        </div>
                    </div>

                    {paymentsSummary.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Оплаты в CRM</h4>
                            <div className="space-y-3">
                                {paymentsSummary.map((payment: any) => (
                                    <div key={payment.id || payment.type} className="border border-gray-100 rounded-lg p-4 flex flex-col gap-1 bg-gray-50">
                                        <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                                            <span>{payment.type || 'Оплата'}</span>
                                            <span>{formatCurrency(payment.amount)}</span>
                                        </div>
                                        {payment.date && <span className="text-xs text-gray-500">Дата: {formatDate(payment.date)}</span>}
                                        {payment.status && <span className="text-xs text-gray-500">Статус: {payment.status}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                <section id="order-custom-fields" className="space-y-6">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Дополнительные данные</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                            <InfoField label="Roistat" value={roistat || '—'} />
                            <InfoField label="Причина отмены" value={payload.cancelReason || '—'} />
                            <InfoField label="Форма закупки" value={purchaseForm || 'Требуется уточнить'} />
                            <InfoField label="Плановая дата закупки" value={formatDate(planPurchaseDate)} />
                            <InfoField label="Маржа" value={marginValue ? `${marginValue} %` : '—'} />
                            <InfoField label="Часовой пояс" value={timezoneValue || '—'} />
                            <InfoField label="Датасчёт" value={dsDocument || '—'} />
                            <InfoField label="Изменение менеджера" value={changeManager || '—'} />
                            <InfoField label="Контрагент" value={payload.contragent?.contragentType || '—'} />
                            <InfoField label="Email" value={payload.email || '—'} />
                            <InfoField label="Телефон" value={primaryPhone || '—'} />
                            <InfoField label="Файлы" value={data.emails?.length ? `${data.emails.length} вложений` : 'Нет файлов'} />
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h4 className="text-sm font-semibold text-gray-900 mb-4">Комментарии менеджера</h4>
                        <div className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 border border-gray-100 rounded-lg p-4 min-h-[120px]">
                            {operatorComment || 'Комментариев нет.'}
                        </div>
                    </div>
                </section>
            </div>
        );
    };

    const handleSectionNavClick = (sectionId: string) => {
        const target = document.getElementById(sectionId);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const renderQualityView = () => {
        if (!data) return null;

        const activeCall = qualityCalls[selectedCallIndex] || null;
        const primaryClientNumber = activeCall
            ? activeCall.direction === 'incoming'
                ? (activeCall.from_number || activeCall.from_number_normalized)
                : (activeCall.to_number || activeCall.to_number_normalized)
            : null;
        const secondaryClientNumber = activeCall
            ? activeCall.direction === 'incoming'
                ? (activeCall.to_number || activeCall.to_number_normalized)
                : (activeCall.from_number || activeCall.from_number_normalized)
            : null;
        const callNumbers = activeCall
            ? Array.from(new Set([primaryClientNumber, secondaryClientNumber].filter((num): num is string => Boolean(num))))
            : [];
        const managerIdString = typeof data.order?.manager_id === 'number'
            ? String(data.order.manager_id)
            : (typeof qualityScore?.manager_id === 'number' ? String(qualityScore.manager_id) : null);
        const orderIdString = String(orderId);
        const breakdown = qualityScore?.score_breakdown as Record<string, ScoreBreakdownEntry> | undefined;
        const scoreBreakdownEntries = breakdown
            ? Object.entries(breakdown).filter(([, info]) => info && info.reason)
            : [];
        const isInitialLoading = !qualityFetched && (qualityCallsLoading || qualityScoreLoading);

        return (
            <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b bg-white flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs uppercase text-gray-400">ОКК · Контроль качества</p>
                        <h3 className="text-2xl font-semibold text-gray-900">Звонки и анализ #{orderId}</h3>
                        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>Менеджер: <strong className="text-gray-900">{qualityScore?.manager_name || data.order?.manager_name || '—'}</strong></span>
                            <span className="flex items-center gap-2">
                                Статус:
                                <span
                                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{ backgroundColor: qualityScore?.status_color || '#E0E7FF', color: '#111827' }}
                                >
                                    {qualityScore?.status_label || data.order?.status || '—'}
                                </span>
                            </span>
                            <span>Сумма: <strong>{formatCurrency(qualityScore?.total_sum || data.order?.totalsumm)}</strong></span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleQualityRefresh}
                            disabled={qualityCallsLoading || qualityScoreLoading}
                            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            ↻ Обновить
                        </button>
                    </div>
                </div>

                {qualityError && (
                    <div className="px-6 py-3 bg-red-50 text-red-600 text-sm border-b border-red-100">{qualityError}</div>
                )}

                {isInitialLoading ? (
                    <div className="flex items-center justify-center py-16 bg-slate-50">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    </div>
                ) : (
                    <div className="flex flex-col min-h-[560px] bg-slate-50/60">
                        <div className="flex md:hidden border-b bg-white text-[10px] font-black uppercase tracking-widest text-gray-500">
                            <button
                                onClick={() => setQualityMobileTab('calls')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'calls' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Звонки
                            </button>
                            <button
                                onClick={() => setQualityMobileTab('transcript')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'transcript' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Текст
                            </button>
                            <button
                                onClick={() => setQualityMobileTab('analysis')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'analysis' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Анализ
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                            <aside className={`${qualityMobileTab === 'calls' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r bg-gray-50/60 overflow-y-auto flex-col`}>
                                <div className="p-3 border-b bg-white/70 sticky top-0">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">История разговоров</h4>
                                </div>
                                {qualityCalls.some((call) => call.is_fallback) && (
                                    <div className="m-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                                        <strong className="block mb-1">Звонки ещё обрабатываются</strong>
                                        Семён подтягивает записи, детальный анализ появится чуть позже.
                                    </div>
                                )}
                                {qualityCallsLoading && qualityCalls.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center py-12">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                                    </div>
                                ) : qualityCalls.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-xs italic">Звонки не найдены</div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {qualityCalls.map((call, idx) => (
                                            <button
                                                key={`${call.telphin_call_id || call.started_at || idx}`}
                                                onClick={() => {
                                                    setSelectedCallIndex(idx);
                                                    if (qualityMobileTab !== 'calls') {
                                                        setQualityMobileTab('transcript');
                                                    }
                                                }}
                                                className={`w-full text-left p-3 md:p-4 hover:bg-white transition-colors border-l-4 ${selectedCallIndex === idx ? 'bg-white border-blue-600 shadow-sm' : 'border-transparent'}`}
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${call.direction === 'outgoing' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                        {call.direction === 'outgoing' ? 'Исходящий' : 'Входящий'}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-mono">{call.duration_sec}s</span>
                                                </div>
                                                <div className="text-xs font-semibold text-gray-800 flex justify-between">
                                                    <span>{new Date(call.started_at).toLocaleDateString('ru-RU')}</span>
                                                    <span className="text-[10px] text-gray-500 font-normal">{new Date(call.started_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                {call.match_explanation?.includes('[Внимание: звонил другой менеджер]') && (
                                                    <div className="mt-1 text-[9px] font-black text-red-600 bg-red-50 rounded px-1.5 py-0.5 inline-block">⚠️ Другой менеджер</div>
                                                )}
                                                {call.transcript && (
                                                    <div className="mt-2 text-[10px] text-blue-500 flex items-center gap-1">
                                                        <span>📝 Транскрибация</span>
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </aside>

                            <div className={`${qualityMobileTab !== 'calls' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 bg-white`}>
                                {qualityCalls.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center">
                                        <div>
                                            <div className="text-4xl mb-4">👆</div>
                                            Добавьте звонки, чтобы появился разбор.
                                        </div>
                                    </div>
                                ) : activeCall ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        <div className="p-3 md:p-4 border-b bg-white flex flex-col md:flex-row md:items-center gap-3">
                                            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full">
                                                <div>
                                                    <span className="text-[9px] text-gray-400 uppercase font-black block">Откуда · Куда</span>
                                                    <span className="text-xs font-mono font-bold text-gray-700">
                                                        {(activeCall.from_number || activeCall.from_number_normalized) || '—'} → {(activeCall.to_number || activeCall.to_number_normalized) || '—'}
                                                    </span>
                                                </div>
                                                {activeCall.recording_url && (
                                                    <div className="flex items-center gap-2 w-full md:w-auto">
                                                        <audio
                                                            src={activeCall.raw_payload?.storage_url || `/api/okk/proxy-audio?url=${encodeURIComponent(activeCall.recording_url)}`}
                                                            controls
                                                            className="h-10 md:h-8 md:w-64 w-full accent-blue-600"
                                                        />
                                                        <a
                                                            href={activeCall.raw_payload?.storage_url || activeCall.recording_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hidden md:flex p-1.5 px-3 text-xs font-bold border border-gray-200 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-200"
                                                        >
                                                            Скачать
                                                        </a>
                                                    </div>
                                                )}
                                                <div className="flex flex-col gap-1 w-full md:w-auto">
                                                    <span className="text-[9px] text-gray-400 uppercase font-black">Позвонить клиенту</span>
                                                    {managerIdString ? (
                                                        callNumbers.length > 0 ? (
                                                            <div className="flex flex-wrap items-center gap-4">
                                                                {callNumbers.map((number, idx) => (
                                                                    <div key={`${number}-${idx}`} className="flex flex-col gap-1 min-w-[150px]">
                                                                        <span className="text-[10px] text-gray-500 uppercase">{idx === 0 ? 'Основной' : 'Дополнительный'}</span>
                                                                        <span className="text-xs font-mono text-gray-900">{number}</span>
                                                                        <CallInitiator phoneNumber={number} managerId={managerIdString} orderId={orderIdString} />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[11px] text-gray-400">Телефон не найден</span>
                                                        )
                                                    ) : (
                                                        <span className="text-[11px] text-gray-400">Назначьте менеджера, чтобы звонить прямо отсюда</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                                            <div className={`${qualityMobileTab === 'transcript' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r overflow-hidden`}>
                                                <div className="p-3 bg-gray-50/70 border-b hidden md:block">
                                                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Текст разговора</h5>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 bg-gray-50/40">
                                                    {activeCall.transcript ? (
                                                        <div className="text-xs md:text-sm text-gray-700 leading-relaxed space-y-2">
                                                            {activeCall.transcript.split('\n').map((line: string, i: number) => {
                                                                const managerLine = line.startsWith('Менеджер:');
                                                                const clientLine = line.startsWith('Клиент:');
                                                                if (managerLine) {
                                                                    return (
                                                                        <div key={i} className="bg-white rounded-lg border border-blue-100 px-3 py-2">
                                                                            <span className="text-blue-700 font-bold">Менеджер:</span> {line.replace('Менеджер:', '').trim()}
                                                                        </div>
                                                                    );
                                                                }
                                                                if (clientLine) {
                                                                    return (
                                                                        <div key={i} className="bg-white rounded-lg border border-orange-100 px-3 py-2">
                                                                            <span className="text-orange-600 font-bold">Клиент:</span> {line.replace('Клиент:', '').trim()}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <div key={i} className="px-3 py-1 text-gray-600">{line}</div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                                                            <span className="text-3xl">🔇</span>
                                                            {activeCall.recording_url ? (
                                                                <button
                                                                    onClick={handleTranscribeCall}
                                                                    disabled={transcribing}
                                                                    className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 disabled:opacity-50 border border-blue-100"
                                                                >
                                                                    {transcribing ? 'Обработка...' : 'Запустить транскрибацию'}
                                                                </button>
                                                            ) : (
                                                                <p className="text-xs italic">Нет записи — нечего расшифровывать</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`${qualityMobileTab === 'analysis' ? 'flex' : 'hidden'} md:flex w-full md:w-96 flex-col bg-gray-50/40 overflow-hidden`}>
                                                <div className="p-3 bg-fuchsia-50 border-b border-fuchsia-100 flex items-center gap-2">
                                                    <span className="text-lg">🤓</span>
                                                    <div>
                                                        <h5 className="text-xs font-bold text-fuchsia-900">Анализ Максима</h5>
                                                        <p className="text-[9px] text-fuchsia-600 font-black uppercase tracking-widest">Сводный срез по всем звонкам</p>
                                                    </div>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4">
                                                    {qualityScore?.evaluator_comment ? (
                                                        <div>
                                                            <h6 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                                                <span>📋</span> Общее резюме
                                                            </h6>
                                                            <div className="text-xs text-gray-800 bg-white p-3 rounded-xl border border-gray-100 shadow-sm leading-relaxed">
                                                                {qualityScore.evaluator_comment}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-center text-xs text-gray-400 italic py-6">
                                                            Анализ ещё не выполнен.
                                                        </div>
                                                    )}

                                                    {scoreBreakdownEntries.length > 0 && (
                                                        <div>
                                                            <h6 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                                                <span>🔍</span> Ключевые моменты
                                                            </h6>
                                                            <div className="space-y-2">
                                                                {scoreBreakdownEntries.filter(([key]) => isVisibleBreakdownKey(key)).map(([key, info]) => (
                                                                    <div key={key} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                                                                        <div className="flex items-center gap-1.5 mb-1.5">
                                                                            <span className={info?.result ? 'text-green-500' : 'text-red-500'}>
                                                                                {info?.result ? '✅' : '❌'}
                                                                            </span>
                                                                            <span className="text-[10px] font-bold text-gray-700">
                                                                                {formatQualityCriterionLabel(key)}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-[11px] text-gray-600 leading-normal italic">{info?.reason}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center">
                                        <div>
                                            <div className="text-4xl mb-4">👆</div>
                                            Выберите звонок слева, чтобы увидеть детали.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
                <header className="border-b bg-white px-6 py-5">
                    <div className="flex items-start justify-between gap-6">
                        <div>
                            <p className="text-xs uppercase text-gray-400 mb-1">Заявка</p>
                            <h2 className="text-2xl font-semibold text-gray-900">Заказ #{orderId}</h2>
                            {data?.order && (
                                <div className="flex flex-wrap gap-4 text-sm text-gray-600 mt-2">
                                    <span>Сумма: <strong>{formatCurrency(data.order.totalsumm)}</strong></span>
                                    <span>Поступил: {formatDateTime(data.order.created_at)}</span>
                                    <span>Менеджер: {data.order.manager_name || '—'}</span>
                                </div>
                            )}
                            {/* Блок светофора по контрагенту */}
                            {counterpartyScoreLoading ? (
                                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">Проверка контрагента...</div>
                            ) : counterpartyScore ? (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className={`inline-block w-3 h-3 rounded-full ${
                                        counterpartyScore.risk_score === 'red' ? 'bg-red-500' :
                                        counterpartyScore.risk_score === 'yellow' ? 'bg-yellow-400' :
                                        'bg-green-500'
                                    }`}></span>
                                    <span className="text-xs font-semibold">
                                        {counterpartyScore.summary}
                                    </span>
                                </div>
                            ) : null}
                        </div>

                        {/* Deal Score Header Block */}
                        <div className="flex items-center gap-4 ml-auto mr-4 group relative">
                            <div className="text-right">
                                <p className="text-[10px] uppercase tracking-widest font-black text-gray-400 mb-0.5">Deal Score</p>
                                {qualityScoreLoading ? (
                                    <div className="h-9 w-16 bg-gray-100 animate-pulse rounded ml-auto"></div>
                                ) : (
                                    <>
                                        <p className="text-3xl font-black text-blue-600 leading-none">
                                            {qualityScore?.deal_score_pct !== undefined && qualityScore?.deal_score_pct !== null ? `${qualityScore.deal_score_pct}%` : '—'}
                                        </p>
                                        {qualityScore?.deal_score !== undefined && qualityScore?.deal_score !== null && (
                                            <p className="text-xs text-gray-500 mt-0.5">({qualityScore.deal_score}/100)</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-2 shrink-0">
                            <button className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Печать</button>
                            <button className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Действия</button>
                            <button className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Задачи 0/0</button>
                            <button className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Файлы</button>
                            <button className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">История</button>
                            <button onClick={onClose} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50">✕</button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4 text-xs font-semibold">
                        {headerBadges.length > 0 ? (
                            headerBadges.map(badge => (
                                <span key={badge.label} className={`px-3 py-1 rounded-full ${badge.className}`}>
                                    {badge.label}
                                </span>
                            ))
                        ) : (
                            <span className="px-3 py-1 bg-gray-100 rounded-full text-gray-500">Статусы не найдены</span>
                        )}
                    </div>
                </header>

                <nav className="border-b bg-white px-6">
                    <div className="flex overflow-x-auto text-sm">
                        {viewTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setViewTab(tab.id)}
                                className={`py-4 px-4 border-b-2 -mb-px transition-colors ${viewTab === tab.id ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <main className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-50 text-red-600 rounded-lg">Ошибка загрузки: {error}</div>
                    ) : (
                        data && (
                            <div className="space-y-8">
                                {viewTab === 'card' ? (
                                    <>
                                        <div className="bg-white border border-gray-200 rounded-full px-4 py-2 flex flex-wrap gap-2 text-sm shadow-sm">
                                            {sectionNavItems.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => handleSectionNavClick(item.id)}
                                                    className="px-3 py-1 rounded-full text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                        {renderCardContent()}
                                    </>
                                ) : (
                                    renderQualityView()
                                )}
                            </div>
                        )
                    )}
                </main>

                <footer className="border-t bg-white px-6 py-4 flex items-center justify-between">
                    <div className="flex gap-3">
                        <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700">Сохранить</button>
                        <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">Сохранить и выйти</button>
                    </div>
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Закрыть</button>
                </footer>
            </div>
        </div>
    );
}
