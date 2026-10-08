/**
 * Письмо клиенту, которое пишет ИИ по шаблону-промпту.
 *
 * Шаблон задаёт сценарий («отправляем КП», «напоминаем после КП»), а текст
 * собирается под конкретный заказ: что заказали, на какую сумму, о чём
 * договаривались в комментариях. Менеджер правит письмо руками перед отправкой —
 * ИИ готовит, человек отправляет (как и в остальных действиях помощника).
 *
 * Чего ИИ не делает никогда: не называет сроки, цены и условия, которых нет в
 * заказе. Выдуманное обещание клиенту дороже, чем пустое место в письме.
 */
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import type { OrderTemplateContext } from './render';

export type AiLetter = { subject: string; text: string };

const SYSTEM = [
    'Ты менеджер отдела продаж завода металлоконструкций. Пишешь письмо клиенту по-русски.',
    'Пиши коротко и по делу: приветствие, суть, что от клиента нужно. ПОДПИСЬ НЕ ПИШИ — её добавляет система: имя менеджера, добавочный, телефон и сайт.',
    'Первая строка письма — ГОТОВОЕ ОБРАЩЕНИЕ, которое дано в данных заказа полем «обращение». Напиши его дословно и не переделывай: по имени и отчеству, без фамилии.',
    'Никакого канцелярита и рекламы. Обращение на «вы».',
    'Запрещено придумывать то, чего нет в данных заказа: сроки, цены, скидки, наличие, характеристики.',
    'Если данных для фразы не хватает — не пиши эту фразу вовсе.',
    'Суммы и количества пиши с разделителями разрядов и знаком рубля: 53 800 ₽ (закон компании о числах).',
    'Перечисляй все позиции заказа, ни одну не пропускай.',
    'Ответ верни строго в JSON: {"subject": "тема письма", "text": "текст письма с переносами строк"}.',
].join(' ');

/** Данные заказа, которые видит ИИ. Лишнего не даём: письмо — не выгрузка базы. */
function orderFacts(context: OrderTemplateContext) {
    const order: any = context.order || {};
    const items = (order.items || []).map((item: any) => ({
        название: item?.offer?.name || item?.productName || 'позиция',
        количество: item?.quantity,
        цена: item?.initialPrice ?? item?.price,
    }));

    return {
        номер_заказа: order.number,
        клиент: order.contragent?.legalName || order.customer?.nickName || order.firstName || null,
        контактное_лицо: [order.lastName, order.firstName].filter(Boolean).join(' ') || null,
        // Обращение собрано кодом: по имени и отчеству, с запасным вариантом,
        // если отчества нет. Модель пишет его дословно первой строкой.
        обращение: context.greeting,
        состав: items,
        сумма: order.totalSumm ?? order.summ ?? null,
        комментарий_клиента: order.customerComment || null,
        комментарий_менеджера: order.managerComment || null,
        адрес_доставки: order.delivery?.address?.text || null,
    };
}

export async function writeLetter(prompt: string, context: OrderTemplateContext): Promise<AiLetter> {
    if (!isOpenAIConfigured()) {
        throw new Error('ИИ не настроен на сервере — шаблон с заданием не соберётся. Выберите обычный шаблон.');
    }

    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: [
                    `Задание: ${prompt}`,
                    `Данные заказа: ${JSON.stringify(orderFacts(context), null, 1)}`,
                ].join('\n\n'),
            },
        ],
    });

    const raw = response.choices?.[0]?.message?.content || '{}';
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('ИИ вернул не то, что ожидали — попробуйте ещё раз или напишите письмо руками.');
    }

    const subject = String(parsed.subject || '').trim();
    const text = String(parsed.text || '').trim();

    if (!subject || !text) {
        throw new Error('ИИ не написал письмо — напишите руками или попробуйте другой шаблон.');
    }

    return { subject, text };
}
