'use client';

import { ReactNode, useEffect, useState } from 'react';
import CallInitiator from './calls/CallInitiator';
import CallHistory from './calls/CallHistory';

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

const qualityTabs = [
    { id: 'info', label: 'Информация' },
    { id: 'history', label: 'История' },
    { id: 'ai', label: 'Аудит Анны' },
] as const;

type ViewTab = typeof viewTabs[number]['id'];
type QualityTab = typeof qualityTabs[number]['id'];

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

export default function OrderDetailsModal({ orderId, isOpen, onClose }: OrderDetailsModalProps) {
    const [data, setData] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewTab, setViewTab] = useState<ViewTab>('card');
    const [qualityTab, setQualityTab] = useState<QualityTab>('info');
    const [analyzing, setAnalyzing] = useState(false);

    useEffect(() => {
        if (isOpen && orderId) {
            fetchDetails();
            setViewTab('card');
            setQualityTab('info');
        }
    }, [isOpen, orderId]);

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/details`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRunAnalysis = async () => {
        if (!orderId) return;
        setAnalyzing(true);
        try {
            const res = await fetch(`/api/orders/${orderId}/analyze`, { method: 'POST' });
            if (!res.ok) throw new Error('Analysis failed');
            await fetchDetails();
        } catch (e) {
            console.error(e);
            alert('Ошибка при запуске анализа');
        } finally {
            setAnalyzing(false);
        }
    };

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
        const paymentEntries = Array.isArray(paymentSource) ? paymentSource : Object.values(paymentSource);
        const contactPhones = Array.isArray(contact.phones) ? contact.phones.map((p: any) => p.number).filter(Boolean) : [];
        const storedPhones = Array.isArray(order.customer_phones) ? order.customer_phones : [];
        const normalizedPhones = [payload.phone, order.phone, ...contactPhones, ...storedPhones].filter(Boolean);
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
        const items = Array.isArray(payload.items) ? payload.items : Array.isArray(order.items) ? order.items : [];
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
                                            const properties = [...(item.offer?.properties || []), ...(item.properties || [])]
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

    const renderQualityPanel = () => (
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
                <div>
                    <p className="text-xs uppercase text-gray-400">AI + Телефония</p>
                    <h3 className="text-xl font-semibold text-gray-900">Качество обработки заявки</h3>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                    {qualityTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setQualityTab(tab.id)}
                            className={`px-3 py-1.5 rounded-full border ${qualityTab === tab.id ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-200'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="px-6 py-6 bg-slate-50 space-y-6">{renderQualityContent()}</div>
        </section>
    );

    const renderQualityContent = () => {
        if (!data) return null;

        if (qualityTab === 'info') {
            return (
                <div className="space-y-6">
                    <section>
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">📞 Звонки и транскрибация</h4>
                        {data.calls.length === 0 ? (
                            <p className="text-sm text-gray-500 italic">Звонков по заказу не найдено.</p>
                        ) : (
                            <div className="space-y-4">
                                {data.calls.map((call: any) => (
                                    <div key={call.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                                <span className={`px-2 py-0.5 rounded uppercase font-bold ${call.type === 'incoming' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {call.type === 'incoming' ? 'Входящий' : 'Исходящий'}
                                                </span>
                                                <span className="text-gray-500">{new Date(call.date).toLocaleString('ru-RU')}</span>
                                                <span className="text-gray-400">({Math.floor(call.duration / 60)}м {call.duration % 60}с)</span>
                                            </div>
                                            {call.link && (
                                                <a
                                                    href={call.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                                >
                                                    🎧 Запись
                                                </a>
                                            )}
                                        </div>
                                        {call.summary && (
                                            <div className="mb-3 p-3 bg-fuchsia-50 rounded border border-fuchsia-100 text-sm text-gray-800">
                                                <strong className="text-fuchsia-700 text-xs block mb-1">AI Summary:</strong>
                                                {call.summary}
                                            </div>
                                        )}
                                        {call.transcription ? (
                                            <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono bg-gray-50 p-3 rounded border">
                                                {call.transcription}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-400 italic">Транскрибация отсутствует...</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section>
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">☎️ Управление звонками</h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">Совершить звонок</h5>
                                {data.order?.phone ? (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1">Номер телефона</label>
                                            <input
                                                type="tel"
                                                value={data.order.phone}
                                                readOnly
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono"
                                            />
                                        </div>
                                        <CallInitiator
                                            phoneNumber={data.order.phone}
                                            managerId={String(data.order.manager_id)}
                                            orderId={String(orderId)}
                                            customerName={`${data.raw_payload?.firstName || ''} ${data.raw_payload?.lastName || ''}`.trim()}
                                        />
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500 italic">Номер телефона не найден</p>
                                )}
                            </div>

                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">История звонков</h5>
                                <CallHistory orderId={String(orderId)} limit={5} />
                            </div>
                        </div>
                    </section>

                    <section>
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">💬 Комментарии менеджера</h4>
                        {data.raw_payload?.managerComment ? (
                            <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-gray-800">
                                {data.raw_payload.managerComment}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 italic">Комментариев нет.</p>
                        )}
                    </section>

                    <section>
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">👤 Клиент</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="p-3 bg-white rounded border border-gray-200">
                                <span className="text-gray-500 text-xs block">Имя</span>
                                <span className="font-medium text-gray-900">{data.raw_payload?.firstName} {data.raw_payload?.lastName}</span>
                            </div>
                            <div className="p-3 bg-white rounded border border-gray-200">
                                <span className="text-gray-500 text-xs block">Телефон</span>
                                <span className="font-medium text-gray-900 font-mono">{data.raw_payload?.phone}</span>
                            </div>
                            <div className="p-3 bg-white rounded border border-gray-200 col-span-2">
                                <span className="text-gray-500 text-xs block">Адрес / Доставка</span>
                                <span className="font-medium text-gray-900">{data.raw_payload?.delivery?.address?.text || 'Не указан'}</span>
                            </div>
                        </div>
                    </section>
                </div>
            );
        }

        if (qualityTab === 'history') {
            return (
                <section className="space-y-4">
                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">📜 История изменений</h4>
                    {(!data.history || data.history.length === 0) ? (
                        <div className="text-center py-8 text-gray-500 text-sm">История изменений не найдена или еще не синхронизирована.</div>
                    ) : (
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden text-sm">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Дата</th>
                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Пользователь</th>
                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Поле</th>
                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Старое</th>
                                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase">Новое</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {data.history.map((h: any, i: number) => (
                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(h.occurred_at).toLocaleString('ru-RU')}</td>
                                            <td className="px-4 py-3 text-gray-800">{h.user_data?.firstName} {h.user_data?.lastName}</td>
                                            <td className="px-4 py-3 font-medium text-gray-700">{h.field}</td>
                                            <td className="px-4 py-3 text-red-600 bg-red-50/30">{h.old_value}</td>
                                            <td className="px-4 py-3 text-green-600 bg-green-50/30">{h.new_value}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            );
        }

        return (
            <section className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <img src="/images/agents/anna.png" alt="Anna" className="w-12 h-12 rounded-full border-2 border-purple-100 shadow-sm" />
                    <div>
                        <h4 className="text-lg font-bold text-gray-900 leading-tight">Анна: Проверка качества</h4>
                        <p className="text-xs text-purple-600 font-bold uppercase tracking-widest">Бизнес-аналитик ОКК</p>
                    </div>
                </div>

                {!data.priority ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg border border-dashed flex flex-col items-center gap-3">
                        <p>AI-анализ для этого заказа ещё не проводился.</p>
                        <button
                            onClick={handleRunAnalysis}
                            disabled={analyzing}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
                        >
                            {analyzing ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    Анализирую...
                                </>
                            ) : (
                                '⚡ Запустить анализ'
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex justify-end">
                            <button
                                onClick={handleRunAnalysis}
                                disabled={analyzing}
                                className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            >
                                {analyzing ? <span className="animate-spin">↻</span> : <span>↻</span>}
                                Обновить анализ
                            </button>
                        </div>

                        <div className={`p-6 rounded-lg border flex items-start gap-4 ${data.priority.level === 'green' ? 'bg-green-50 border-green-200' : data.priority.level === 'yellow' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                            <div className={`text-4xl ${data.priority.level === 'green' ? 'text-green-500' : data.priority.level === 'yellow' ? 'text-yellow-500' : 'text-red-500'}`}>
                                {data.priority.level === 'green' ? '🟢' : data.priority.level === 'yellow' ? '🟡' : '🔴'}
                            </div>
                            <div className="flex-1">
                                <h5 className="text-lg font-bold text-gray-900 mb-1">Вердикт ИИ: {data.priority.summary}</h5>
                                <p className="text-gray-700 font-medium">Рекомендация: {data.priority.recommended_action}</p>
                                <div className="mt-2 text-xs text-gray-500">
                                    Score: {data.priority.score} · Обновлено: {new Date(data.priority.updated_at).toLocaleString('ru-RU')}
                                </div>
                            </div>
                        </div>

                        {data.insights && (
                            <div className="bg-white rounded-lg border border-purple-200 overflow-hidden shadow-sm">
                                <div className="bg-purple-50 px-4 py-3 border-b border-purple-100 flex items-center gap-2">
                                    <span className="text-purple-600">📊</span>
                                    <h5 className="text-sm font-bold text-purple-900">Аналитика и хронология (Анна)</h5>
                                </div>
                                <div className="p-4 space-y-4">
                                    {data.insights.summary && (
                                        <div>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Резюме сделки</p>
                                            <p className="text-sm text-gray-800 leading-relaxed font-medium bg-gray-50 p-3 rounded">{data.insights.summary}</p>
                                        </div>
                                    )}
                                    {data.insights.dialogue_summary && (
                                        <div>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Хронология коммуникаций</p>
                                            <div className="text-sm text-gray-700 leading-relaxed bg-white border border-gray-100 p-3 rounded italic border-l-4 border-l-purple-400">{data.insights.dialogue_summary}</div>
                                        </div>
                                    )}
                                    {data.insights.recommendations && data.insights.recommendations.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Рекомендации</p>
                                            <ul className="list-disc list-inside text-sm text-gray-800 bg-green-50/50 p-3 rounded border border-green-100">
                                                {data.insights.recommendations.map((rec: string, idx: number) => (
                                                    <li key={idx} className="mb-1 last:mb-0">{rec}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {data.priority.reasons?.analysis_steps && (
                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <div className="bg-gray-50 px-4 py-3 border-b flex items-center gap-2">
                                    <span className="text-gray-500">📋</span>
                                    <h5 className="text-sm font-bold text-gray-700">Детальный разбор (логика РОПа)</h5>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                        <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">1. Сумма</div>
                                        <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.sum_check}</div>
                                    </div>
                                    <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                        <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">2. Товар</div>
                                        <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.product_check}</div>
                                    </div>
                                    <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                        <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">3. Сверка</div>
                                        <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.manager_check}</div>
                                    </div>
                                    <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                        <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">4. История</div>
                                        <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.history_check}</div>
                                    </div>
                                    <div className="px-4 py-3 flex gap-4 hover:bg-gray-50">
                                        <div className="w-32 flex-shrink-0 text-xs font-bold text-gray-400 uppercase pt-1">5. Звонки</div>
                                        <div className="text-sm text-gray-800">{data.priority.reasons.analysis_steps.calls_check}</div>
                                    </div>
                                </div>
                            </div>
                        )}
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
                        </div>
                        <div className="flex gap-2">
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
                                    renderQualityPanel()
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
