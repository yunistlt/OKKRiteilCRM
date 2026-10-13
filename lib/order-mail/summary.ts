/**
 * «О чём договорились» — краткое изложение переписки по заказу (ТЗ §6).
 *
 * Менеджер подхватывает чужой заказ или возвращается к своему через месяц, и
 * первым делом читает двадцать писем подряд. Изложение отвечает на три
 * вопроса: о чём договорились, что мы обещали и что следующий шаг.
 *
 * Это ПОМОЩНИК, а не действие: он ничего не отправляет и ничего не меняет в
 * заказе (закон «помощник готовит, человек подтверждает»).
 */
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import type { MailMessage } from './thread';

const SYSTEM = [
    'Ты помощник менеджера по продажам завода металлоконструкций.',
    'Тебе дают переписку по одному заказу: письма клиента и наши ответы по времени.',
    'Верни JSON: {"agreed": ["..."], "weOwe": ["..."], "nextStep": "..."}.',
    'agreed — о чём договорились (цена, сроки, условия оплаты, состав) словами из переписки.',
    'weOwe — что мы обещали и ещё не сделали. Пусто, если ничего не обещали.',
    'nextStep — одно предложение: что сделать менеджеру сейчас.',
    'Только факты из писем. Ничего не выдумывай, пустое поле лучше догадки.',
    'Пиши по-русски, коротко, как коллега коллеге.',
].join(' ');

export type MailSummary = {
    agreed: string[];
    weOwe: string[];
    nextStep: string | null;
};

/** Переписка текстом для модели: кто, когда и что написал. */
function conversation(messages: MailMessage[]): string {
    return messages
        .slice(-20)
        .map((message) => {
            const who = message.direction === 'in' ? (message.fromName || message.from || 'Клиент') : 'Мы';
            const when = message.at ? new Date(message.at).toLocaleDateString('ru-RU') : 'без даты';
            // Цитаты не отправляем: в них то же самое по второму разу.
            const body = String(message.body ?? '').split(/\n>|\n-{2,}|\nОт кого:/)[0].trim().slice(0, 1500);
            return `${who} (${when}): ${body}`;
        })
        .join('\n\n');
}

export async function summarizeThread(messages: MailMessage[]): Promise<MailSummary> {
    if (!isOpenAIConfigured()) {
        throw new Error('ИИ не настроен на сервере — изложение не собрать.');
    }

    const text = conversation(messages);
    if (text.trim().length < 80) {
        throw new Error('В переписке пока нечего излагать — писем слишком мало.');
    }

    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: text },
        ],
    });

    let parsed: any;
    try {
        parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    } catch {
        throw new Error('ИИ вернул не то, что ожидали — попробуйте ещё раз.');
    }

    const list = (value: unknown): string[] =>
        (Array.isArray(value) ? value : [])
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .slice(0, 6);

    return {
        agreed: list(parsed.agreed),
        weOwe: list(parsed.weOwe),
        nextStep: String(parsed.nextStep ?? '').trim() || null,
    };
}
