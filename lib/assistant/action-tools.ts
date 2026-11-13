import { supabase } from '@/utils/supabase';
import { loadOrderContact } from '@/lib/own-crm/order-contact';

/**
 * Инструменты действий помощника менеджера: письмо клиенту и звонок.
 *
 * ГЛАВНОЕ ПРАВИЛО: помощник НЕ выполняет эти действия. Он собирает их и кладёт в
 * `assistant_actions` со статусом «ожидает подтверждения». Письмо клиенту и звонок —
 * выход наружу, отменить их нельзя, а модель ошибается. Выполняет человек нажатием
 * кнопки: `/api/assistant/actions`.
 *
 * Читающие инструменты (аналитика по своему дню, заказы, рейтинг) живут отдельно и
 * выполняются сразу — там нечему навредить.
 */

export const ASSISTANT_ACTION_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'draft_client_email',
            description:
                'Подготовить письмо клиенту по заказу и показать менеджеру на подтверждение. Вызывай, когда просят написать, ответить или отправить письмо клиенту. Письмо НЕ уходит сразу: менеджер увидит текст и нажмёт «Отправить». Пиши готовый текст письма целиком, без заготовок вида «[укажите срок]» — если данных не хватает, сначала спроси у менеджера.',
            parameters: {
                type: 'object',
                properties: {
                    orderNumber: {
                        type: 'string',
                        description: 'Номер заказа, по которому пишем. По нему письмо привяжется к заказу в CRM.',
                    },
                    to: {
                        type: 'string',
                        description: 'Почта получателя — только если её назвал человек. Не назвали — не передавай: адрес возьмётся из заказа и карточки клиента.',
                    },
                    subject: {
                        type: 'string',
                        description: 'Тема письма человеческим языком, без служебных тегов — их добавит система.',
                    },
                    body: {
                        type: 'string',
                        description: 'Текст письма целиком, готовый к отправке. Обычный текст, абзацы переводом строки.',
                    },
                },
                required: ['orderNumber', 'subject', 'body'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'call_client',
            description:
                'Соединить менеджера с клиентом: сначала звонит аппарат менеджера, он снимает трубку — и АТС набирает клиента. Вызывай на просьбы «позвони клиенту», «свяжи меня с ним», «набери номер». Звонок НЕ уходит сразу: менеджер подтверждает нажатием.',
            parameters: {
                type: 'object',
                properties: {
                    phone: {
                        type: 'string',
                        description: 'Телефон клиента — только если его назвал человек. Не назвали — не передавай: номер возьмётся из заказа и карточки клиента.',
                    },
                    orderNumber: {
                        type: 'string',
                        description: 'Номер заказа, если звоним по конкретному заказу.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Зачем звоним — одной строкой, чтобы менеджер понимал, что подтверждает.',
                    },
                },
            },
        },
    },
];

export const ASSISTANT_ACTION_TOOL_NAMES = ASSISTANT_ACTION_TOOLS.map((t) => t.function.name);

interface ActionContext {
    managerId: number;
}

/**
 * Кладёт действие в очередь подтверждения и возвращает модели то, что она должна
 * сказать менеджеру. Ничего наружу отсюда не уходит.
 */
export async function executeAssistantActionTool(
    name: string,
    args: any,
    ctx: ActionContext
): Promise<string> {
    if (name === 'draft_client_email') {
        const { orderNumber, subject, body } = args || {};
        if (!orderNumber || !subject || !body) {
            return 'Не хватает данных для письма: нужны номер заказа, тема и текст.';
        }

        // Адрес ищем сами. Требовать его от модели было ошибкой: на «напиши
        // клиенту по заказу 41989» она отвечала «уточните email», хотя адрес
        // лежал в карточке клиента (прод, 03.11.2026).
        const to = args?.to || (await loadOrderContact(String(orderNumber)))?.email;
        if (!to) {
            return `Письмо не подготовлено: по заказу ${orderNumber} не нашлось почты ни в заказе, ни в карточке клиента. Скажи менеджеру, что адрес нужно внести в карточку заказчика или назвать прямо в просьбе.`;
        }

        const preview = `Письмо на ${to} по заказу ${orderNumber}\nТема: ${subject}\n\n${body}`;

        const { data, error } = await supabase
            .from('assistant_actions')
            .insert({
                manager_id: ctx.managerId,
                kind: 'email',
                payload: { to, subject, body, orderNumber },
                preview,
                order_number: String(orderNumber),
            })
            .select('id')
            .single();

        if (error) {
            console.error('[assistant-actions] Не удалось сохранить письмо на подтверждение:', error);
            return 'Не получилось подготовить письмо — попробуйте ещё раз.';
        }

        return `Письмо подготовлено и ждёт подтверждения (id ${data.id}). Скажи менеджеру, что текст готов и уйдёт после нажатия «Отправить». Приведи тему и текст письма целиком, чтобы он прочитал их в переписке.`;
    }

    if (name === 'call_client') {
        const { orderNumber, reason } = args || {};
        const phone = args?.phone || (orderNumber ? (await loadOrderContact(String(orderNumber)))?.phone : null);
        if (!phone) {
            return orderNumber
                ? `Звонок не подготовлен: по заказу ${orderNumber} не нашлось телефона ни в заказе, ни в карточке клиента. Скажи менеджеру, что номер нужно внести в карточку заказчика или назвать прямо в просьбе.`
                : 'Звонок не подготовлен: не назван ни номер, ни заказ, по которому его искать.';
        }

        const preview = [
            `Звонок клиенту ${phone}`,
            orderNumber ? `по заказу ${orderNumber}` : null,
            reason ? `Причина: ${reason}` : null,
            'Сначала зазвонит ваш аппарат, после ответа АТС наберёт клиента.',
        ]
            .filter(Boolean)
            .join('\n');

        const { data, error } = await supabase
            .from('assistant_actions')
            .insert({
                manager_id: ctx.managerId,
                kind: 'call',
                payload: { phone, orderNumber: orderNumber || null, reason: reason || null },
                preview,
                order_number: orderNumber ? String(orderNumber) : null,
            })
            .select('id')
            .single();

        if (error) {
            console.error('[assistant-actions] Не удалось сохранить звонок на подтверждение:', error);
            return 'Не получилось подготовить звонок — попробуйте ещё раз.';
        }

        return `Звонок подготовлен и ждёт подтверждения (id ${data.id}). Предупреди менеджера, что сначала зазвонит его аппарат, а клиента АТС наберёт после того, как он снимет трубку.`;
    }

    return `Неизвестное действие: ${name}`;
}
