import { supabase } from '@/utils/supabase';

/**
 * Человеческие названия полей заказа для истории изменений.
 *
 * Закон проекта: в интерфейсе не должно быть технических кодов. У пользовательских полей
 * имя берём из справочника RetailCRM (`retailcrm_custom_fields.name`) — не выдумываем.
 * Системные поля источника-справочника не имеют, для них список ниже.
 */
const SYSTEM_FIELD_LABELS: Record<string, string> = {
    status: 'Статус заказа',
    manager: 'Ответственный менеджер',
    manager_comment: 'Комментарий менеджера',
    customer_comment: 'Комментарий клиента',
    customer: 'Клиент',
    contact: 'Контактное лицо',
    first_name: 'Имя',
    last_name: 'Фамилия',
    patronymic: 'Отчество',
    phone: 'Телефон',
    email: 'Почта',
    number: 'Номер заказа',
    order_type: 'Тип заказа',
    order_method: 'Способ оформления',
    site: 'Магазин',
    total_summ: 'Сумма заказа',
    prepay_sum: 'Предоплата',
    discount_manual_percent: 'Скидка, %',
    discount_manual_amount: 'Скидка, сумма',
    order_product: 'Состав заказа',
    'order_product.summ': 'Сумма позиции',
    'order_product.quantity': 'Количество позиции',
    'order_product.initial_price': 'Цена позиции',
    'order_product.discount_total': 'Скидка по позиции',
    'payments.amount': 'Сумма оплаты',
    'payments.status': 'Статус оплаты',
    'payments.type': 'Способ оплаты',
    'delivery.address': 'Адрес доставки',
    'delivery.cost': 'Стоимость доставки',
    'delivery.date': 'Дата доставки',
    'contragent.contragent_type': 'Тип контрагента',
    'contragent.legal_name': 'Юридическое название',
    'contragent.inn': 'ИНН',
    expired: 'Просрочен',
    shipment_date: 'Дата отгрузки',
    call_back: 'Перезвонить',
};

/**
 * Возвращает функцию перевода кода поля в название.
 * Справочник кастом-полей читаем один раз на запрос, а не на каждую строку истории.
 */
export async function buildFieldLabelResolver(): Promise<(field: string) => string> {
    const customNames = new Map<string, string>();

    try {
        const { data } = await supabase.from('retailcrm_custom_fields').select('code, name');
        for (const row of (data as Array<{ code: string; name: string }> | null) ?? []) {
            if (row.code && row.name) customNames.set(row.code, row.name);
        }
    } catch (e) {
        console.warn('[order-field-labels] Справочник пользовательских полей недоступен:', e);
    }

    return (field: string) => {
        if (!field) return 'Изменение';

        if (SYSTEM_FIELD_LABELS[field]) return SYSTEM_FIELD_LABELS[field];

        if (field.startsWith('custom_')) {
            const code = field.slice('custom_'.length);
            const name = customNames.get(code);
            if (name) return name;
            // Кода нет в справочнике — это сигнал о рассинхроне, но пользователю
            // показывать голый код нельзя.
            return 'Дополнительное поле';
        }

        return SYSTEM_FIELD_LABELS[field] ?? 'Другое поле заказа';
    };
}
