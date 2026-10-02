/**
 * Создание заказа менеджером из нашего интерфейса.
 *
 * Заказ заводится в RetailCRM через её API — так он сразу попадает в общий
 * поток: производство, зарплата, ОКК и боты видят его как любой другой. Пока
 * обе системы живые, изобретать свой номер заказа и свой поток нельзя.
 *
 * Магазин выбирается проверенным путём (`resolveLeadSite`): настроенный, а если
 * он пропал в RetailCRM — запасной. 30.09.2026 это спасло приём заявок.
 */
import { supabase } from '@/utils/supabase';
import { itemTotalWithDiscount, orderTotals } from './discount';
import { assignManagerForNewOrder } from './assign-manager';
import { postRetailCrm, ensureCorporateCustomerId } from '@/lib/retailcrm/leads';
import { resolveLeadSite, reportSiteSubstitution } from '@/lib/retailcrm/lead-site';
import { isOwnCrmManager, insertOwnOrder } from './own-order-insert';

export type NewOrderItem = {
    /** Название позиции — то, что увидит клиент в счёте. */
    name: string;
    quantity: number;
    /** Цена за единицу до скидки. */
    price: number;
    /** Скидка рублями на единицу — как `discountManualAmount` в RetailCRM. */
    discountAmount?: number | null;
    /** Скидка процентом от цены единицы — как `discountManualPercent`. */
    discountPercent?: number | null;
    /** Артикул с сайта, если позицию выбрали из каталога. */
    article?: string | null;
    /** Идентификатор товара на сайте — по нему сверяем цену и строим ссылку. */
    xmlId?: string | null;
    /** То же id сайта, явно: уходит в `offer.externalId`, как у RetailCRM. */
    siteId?: string | null;
};

export type NewOrder = {
    /** Покупатель в RetailCRM, если уже известен. */
    customerId?: number | null;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    companyName?: string | null;
    inn?: string | null;
    items: NewOrderItem[];
    managerId?: number | null;
    /** Код статуса; по умолчанию «Новая». */
    statusCode?: string | null;
    customerComment?: string | null;
    managerComment?: string | null;
    /** Разовая скидка на заказ, рублями. */
    discountAmount?: number | null;
    /** Разовая скидка на заказ, процентом. */
    discountPercent?: number | null;
};

export type CreatedOrder = { id: number; number: string; site: string };

const DEFAULT_STATUS = 'novyi-1';

/**
 * Менеджер, которого RetailCRM примет.
 *
 * У наших внутренних учёток бывает номер менеджера, которого в RetailCRM нет:
 * у админской стоит 999 «Системный Администратор», и заказ от неё не
 * создавался вовсе — CRM отвечала «User with code=999 does not exist»
 * (поймано 30.09.2026). Проверяем по справочнику менеджеров: настоящие приехали
 * из CRM и у них заполнены исходные данные.
 */
export async function usableManagerId(managerId: number | null | undefined): Promise<number | null> {
    if (!managerId) {
        return null;
    }

    const { data } = await supabase
        .from('managers')
        .select('id, active, raw_data')
        .eq('id', managerId)
        .maybeSingle();

    const known = data && (data as any).raw_data && (data as any).active !== false;
    return known ? Number(managerId) : null;
}

/** Сумма позиции с учётом количества и скидки — считаем сами, чтобы показать человеку. */
export function itemTotal(item: NewOrderItem): number {
    return itemTotalWithDiscount(item);
}

/** Сумма заказа: позиции со скидками, минус разовая скидка, плюс доставка. */
export function orderTotal(
    items: NewOrderItem[],
    options: { discountAmount?: number | null; discountPercent?: number | null; deliveryCost?: number | null } = {},
): number {
    return orderTotals(items, options).total;
}

/** Проверка до отправки: что не так с заказом, человеческим языком. */
export function validateNewOrder(order: NewOrder): string[] {
    const problems: string[] = [];

    if (!order.items.length) {
        problems.push('В заказе нет ни одной позиции');
    }

    order.items.forEach((item, index) => {
        if (!item.name?.trim()) {
            problems.push(`Позиция ${index + 1}: не указано название`);
        }
        if (!(Number(item.quantity) > 0)) {
            problems.push(`Позиция ${index + 1}: количество должно быть больше нуля`);
        }
        if (Number(item.price) < 0) {
            problems.push(`Позиция ${index + 1}: цена не может быть отрицательной`);
        }
    });

    if (!order.customerId && !order.phone && !order.email && !order.companyName) {
        problems.push('Не указан клиент: нужен хотя бы телефон, почта или название компании');
    }

    return problems;
}

/** Завести заказ. Возвращает номер, который можно показать клиенту. */
export async function createManagerOrder(order: NewOrder): Promise<CreatedOrder> {
    const problems = validateNewOrder(order);
    if (problems.length) {
        throw new Error(problems.join('; '));
    }

    // У заявки обязательно есть менеджер (требование владельца 02.10.2026):
    // если учётка не даёт годного (у админской номер 999, которого в CRM нет),
    // выбираем так же, как автоприём почты, а не создаём заказ-сироту.
    const assignment = await assignManagerForNewOrder({
        managerId: order.managerId,
        email: order.email,
        phone: order.phone,
    });
    const managerId = assignment.managerId;

    // Менеджер, переведённый на нашу базу, получает заказ здесь же: в
    // RetailCRM он не уходит (решение владельца 30.09.2026). Смотрим на того,
    // кого НАЗНАЧИЛИ: иначе заявка без менеджера уходила бы в RetailCRM даже
    // после назначения на Женю.
    const ownManager = await isOwnCrmManager(managerId);

    const choice = await resolveLeadSite();
    await reportSiteSubstitution(choice);
    const site = choice.site;

    let customerId = order.customerId ?? null;
    if (!customerId) {
        const found = await ensureCorporateCustomerId({
            details: order.companyName || order.inn
                ? { legalName: order.companyName || undefined, inn: order.inn || undefined, contactName: order.contactName || undefined }
                : null,
            name: order.contactName || order.companyName || undefined,
            phone: order.phone || undefined,
            email: order.email || undefined,
        } as any, site);
        customerId = found.id;
    }

    const orderData: any = {
        status: order.statusCode || DEFAULT_STATUS,
        firstName: order.contactName || order.companyName || 'Клиент',
        items: order.items.map((item) => ({
            productName: item.name.trim(),
            initialPrice: Number(item.price) || 0,
            quantity: Number(item.quantity),
            ...(item.xmlId || item.article
                ? { offer: { ...(item.xmlId ? { xmlId: item.xmlId } : {}), ...(item.article ? { article: item.article } : {}) } }
                : {}),
        })),
        source: { source: 'crm-manager' },
    };

    if (order.phone) orderData.phone = order.phone;
    if (order.email) orderData.email = order.email;
    if (order.customerComment) orderData.customerComment = order.customerComment;
    if (order.managerComment) orderData.managerComment = order.managerComment;
    orderData.managerId = managerId;
    if (customerId) orderData.customer = { id: customerId, type: 'customer_corporate' };

    if (ownManager) {
        const own = await insertOwnOrder({ ...orderData, managerId });
        return { id: own.id, number: own.number, site: own.order.site };
    }

    const result = await postRetailCrm('orders/create', 'order', orderData, site);
    if (!result?.success) {
        const reason = result?.errors ? JSON.stringify(result.errors) : (result?.errorMsg || 'неизвестная ошибка');
        throw new Error(`RetailCRM не принял заказ: ${reason}`);
    }

    const number = result.order?.number || result.number || String(result.id);
    return { id: Number(result.id), number: String(number), site };
}
