/**
 * Семён как помощник, а не только консультант.
 *
 * Решение владельца 02.11.2026: «Семён должен стать полноценным помощником для
 * девочек — уметь выполнять их просьбы: поставить задачи, найти заказ,
 * проанализировать заказы и подсказать».
 *
 * Здесь два инструмента: поиск заказов и постановка задачи по заказу.
 *
 * Почему задачу Семён ставит сам, а письма и звонки — нет. Задача живёт внутри
 * системы, видна в карточке заказа и в «Оповещениях», снимается одной кнопкой —
 * ошибиться не страшно. Письмо и звонок уходят клиенту, их не вернуть, и по
 * прежнему решению владельца их готовит помощник, а отправляет человек.
 */
import { supabase } from '@/utils/supabase';
import { formatRub } from '@/lib/format';
import { loadStatusDirectory } from '@/lib/own-crm/status-code';

/** Сколько заказов отдаём: список для разговора, а не выгрузка. */
const MAX_ORDERS = 15;

export const ASSISTANT_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'day_plan',
            description:
                'План на день: заказы, по которым сегодня нужно поработать, причина каждого, отработан ли он уже и чем (звонок, письмо, комментарий, смена статуса). Вызывай на «что у меня на сегодня», «разбери мой план», «что осталось», «почему этот заказ в плане». Менеджер видит свой план, руководитель — по всему отделу.',
            parameters: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'День, ГГГГ-ММ-ДД. По умолчанию сегодня' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'orders_find',
            description:
                'Найти заказы: по номеру, названию клиента, статусу или периоду создания. Отдаёт номер, клиента, статус, сумму, менеджера и дату следующего контакта. Вызывай на просьбы «найди заказ», «какие у меня заказы в таком-то статусе», «покажи заказы клиента», «что у меня висит в просчёте». Менеджер получает только свои заказы.',
            parameters: {
                type: 'object',
                properties: {
                    number: { type: 'string', description: 'Номер заказа целиком или его начало' },
                    client: { type: 'string', description: 'Название клиента или его часть' },
                    status: { type: 'string', description: 'Название статуса по-русски, например «В просчёте»' },
                    created_from: { type: 'string', description: 'Создан не раньше этой даты, ГГГГ-ММ-ДД' },
                    created_to: { type: 'string', description: 'Создан не позже этой даты, ГГГГ-ММ-ДД' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'create_order_task',
            description:
                'Поставить задачу по заказу: она появится в карточке заказа и в «Оповещениях» у того, кто просит. Вызывай, когда человек просит «поставь задачу», «напомни», «надо перезвонить такого-то числа». Задачу ставь только по прямой просьбе и обязательно скажи, по какому заказу и на какой срок её поставил.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: { type: 'string', description: 'Номер заказа' },
                    title: { type: 'string', description: 'Что сделать — словами человека, коротко' },
                    due_date: { type: 'string', description: 'Срок, ГГГГ-ММ-ДД. Без срока задача будет без даты' },
                    due_time: { type: 'string', description: 'Время, ЧЧ:ММ — если человек его назвал' },
                },
                required: ['order_number', 'title'],
            },
        },
    },
] as const;

export const ASSISTANT_TOOL_NAMES: ReadonlySet<string> = new Set<string>(ASSISTANT_TOOLS.map((t) => t.function.name));

export interface AssistantToolContext {
    userRole?: string;
    retailCrmManagerId?: number | null;
    /** Кто просит: этим именем подписывается задача. */
    actorName?: string | null;
    actorUserId?: string | null;
}

/** Менеджер работает только со своими заказами; ОКК, РОП и владелец видят весь отдел. */
function seesWholeTeam(role?: string | null): boolean {
    return role === 'admin' || role === 'okk' || role === 'rop';
}

async function findOrders(args: any, ctx: AssistantToolContext): Promise<any> {
    const statuses = await loadStatusDirectory({ withInactive: true });

    let query = supabase
        .from('orders')
        .select('number, status, totalsumm, customer, customer_id, manager_id, createdAt, raw_payload')
        .is('crm_deleted_at', null)
        .order('createdAt', { ascending: false })
        .limit(MAX_ORDERS);

    if (args?.number) query = query.ilike('number', `${String(args.number).trim()}%`);
    if (args?.client) query = query.ilike('customer->>nickName', `%${String(args.client).trim()}%`);
    if (args?.created_from) query = query.gte('createdAt', String(args.created_from));
    if (args?.created_to) query = query.lte('createdAt', `${String(args.created_to)}T23:59:59`);

    if (args?.status) {
        const wanted = String(args.status).trim().toLowerCase();
        const match = statuses.find((row) => row.name.toLowerCase() === wanted)
            ?? statuses.find((row) => row.name.toLowerCase().includes(wanted));
        if (!match) {
            return {
                available: false,
                reason: `Статуса «${args.status}» нет на доске. Назовите статус так, как он написан в «Статусах и переходах».`,
            };
        }
        query = query.eq('status', match.code);
    }

    if (!seesWholeTeam(ctx.userRole)) {
        if (!ctx.retailCrmManagerId) {
            return { available: false, reason: 'Не вижу, чьи заказы показывать: у вашей учётной записи нет номера менеджера.' };
        }
        query = query.eq('manager_id', ctx.retailCrmManagerId);
    }

    const { data, error } = await query;
    if (error) return { available: false, reason: error.message };

    const nameByCode = new Map(statuses.map((row) => [row.code, row.name]));

    // Почта и телефон: без них нельзя ни написать письмо, ни позвонить, а
    // Семён шёл сюда именно за этим и упирался в «не хватает email».
    const clientIds = Array.from(new Set(((data ?? []) as any[]).map((o) => o.customer_id).filter(Boolean)));
    const contactById = new Map<number, { email: string | null; phone: string | null }>();
    if (clientIds.length > 0) {
        const { data: cards } = await supabase.from('clients').select('id, email, phones').in('id', clientIds);
        for (const row of (cards ?? []) as any[]) {
            const phones = row.phones;
            contactById.set(Number(row.id), {
                email: row.email ?? null,
                phone: Array.isArray(phones) ? phones[0]?.number ?? phones[0] ?? null : null,
            });
        }
    }

    const managerIds = Array.from(new Set(((data ?? []) as any[]).map((o) => o.manager_id).filter(Boolean)));
    const managerById = new Map<number, string>();
    if (managerIds.length > 0) {
        const { data: managers } = await supabase.from('managers').select('id, first_name, last_name').in('id', managerIds);
        for (const row of (managers ?? []) as any[]) {
            managerById.set(Number(row.id), [row.first_name, row.last_name].filter(Boolean).join(' '));
        }
    }

    const orders = ((data ?? []) as any[]).map((o) => ({
        number: o.number,
        client: o.customer?.nickName ?? o.raw_payload?.contragent?.legalName ?? null,
        status: nameByCode.get(o.status) ?? o.status,
        amount: Number(o.totalsumm ?? 0),
        amountText: formatRub(o.totalsumm),
        manager: o.manager_id ? managerById.get(Number(o.manager_id)) ?? null : null,
        email: o.raw_payload?.email ?? contactById.get(Number(o.customer_id))?.email ?? null,
        phone: contactById.get(Number(o.customer_id))?.phone ?? null,
        createdAt: String(o.createdAt ?? '').slice(0, 10),
        nextContactDate: o.raw_payload?.customFields?.data_kontakta ?? null,
    }));

    return {
        available: true,
        found: orders.length,
        limited: orders.length === MAX_ORDERS ? `Показаны первые ${MAX_ORDERS}, уточните запрос` : undefined,
        orders,
    };
}

async function createTask(args: any, ctx: AssistantToolContext): Promise<any> {
    const orderNumber = String(args?.order_number ?? '').trim();
    const title = String(args?.title ?? '').trim();
    if (!orderNumber || !title) return { available: false, reason: 'Нужны номер заказа и что сделать.' };

    const { data: order } = await supabase
        .from('orders')
        .select('number, manager_id, customer')
        .eq('number', orderNumber)
        .is('crm_deleted_at', null)
        .maybeSingle();

    if (!order) return { available: false, reason: `Заказа №${orderNumber} нет в базе.` };

    // Чужой заказ менеджеру не трогаем: задача попадёт не тому человеку.
    if (!seesWholeTeam(ctx.userRole)
        && ctx.retailCrmManagerId
        && Number((order as any).manager_id) !== Number(ctx.retailCrmManagerId)) {
        return { available: false, reason: `Заказ №${orderNumber} ведёт другой менеджер — задачу по нему поставить нельзя.` };
    }

    const { data, error } = await supabase
        .from('order_tasks')
        .insert({
            order_number: orderNumber,
            title,
            due_date: args?.due_date || null,
            due_time: args?.due_time || null,
            // Задачу просил человек, Семён только записал — поэтому источник
            // «manager», а автор тот, кто спрашивал.
            source: 'manager',
            created_by: ctx.actorName || 'Семён по просьбе',
            created_by_user_id: ctx.actorUserId ?? null,
        })
        .select('id, order_number, title, due_date, due_time')
        .maybeSingle();

    if (error) return { available: false, reason: error.message };

    return {
        available: true,
        created: true,
        task: data,
        where: `Задача видна в карточке заказа №${orderNumber} и во вкладке «Задачи» в «Оповещениях».`,
    };
}

async function dayPlan(args: any, ctx: AssistantToolContext): Promise<any> {
    const date = String(args?.date ?? '').match(/^\d{4}-\d{2}-\d{2}$/)
        ? String(args.date)
        : new Date().toISOString().slice(0, 10);

    let query = supabase
        .from('sales_rop_task')
        .select('order_number, client, amount, reason_text, status_name, touched, touch_kind, manager_id')
        .eq('plan_date', date);

    if (!seesWholeTeam(ctx.userRole)) {
        if (!ctx.retailCrmManagerId) {
            return { available: false, reason: 'Не вижу, чей план показывать: у вашей учётной записи нет номера менеджера.' };
        }
        query = query.eq('manager_id', ctx.retailCrmManagerId);
    }

    const { data, error } = await query;
    if (error) return { available: false, reason: error.message };

    const rows = (data ?? []) as any[];
    if (rows.length === 0) {
        return { available: true, date, total: 0, note: `На ${date} задач в плане нет.` };
    }

    const managerIds = Array.from(new Set(rows.map((r) => r.manager_id).filter(Boolean)));
    const managerById = new Map<number, string>();
    if (managerIds.length > 1) {
        const { data: managers } = await supabase.from('managers').select('id, first_name, last_name').in('id', managerIds);
        for (const row of (managers ?? []) as any[]) {
            managerById.set(Number(row.id), [row.first_name, row.last_name].filter(Boolean).join(' '));
        }
    }

    const tasks = rows.map((r) => ({
        order: r.order_number,
        client: r.client,
        amount: Number(r.amount ?? 0),
        amountText: formatRub(r.amount),
        status: r.status_name,
        reason: r.reason_text,
        done: Boolean(r.touched),
        // Чем именно закрыли задачу: перенос даты её не закрывает.
        doneBy: r.touch_kind ?? null,
        manager: managerById.get(Number(r.manager_id)) ?? undefined,
    }));

    return {
        available: true,
        date,
        total: tasks.length,
        done: tasks.filter((t) => t.done).length,
        left: tasks.filter((t) => !t.done).length,
        rule: 'Задача считается отработанной, если по заказу сегодня был звонок, письмо, комментарий или смена статуса. Перенос даты следующего контакта задачу не закрывает.',
        tasks,
    };
}

export async function executeAssistantTool(name: string, args: any, ctx: AssistantToolContext): Promise<any> {
    if (name === 'day_plan') return dayPlan(args, ctx);
    if (name === 'orders_find') return findOrders(args, ctx);
    if (name === 'create_order_task') return createTask(args, ctx);
    return { available: false, reason: `Неизвестный инструмент помощника: ${name}` };
}
