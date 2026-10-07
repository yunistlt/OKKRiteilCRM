/**
 * Замечания ИИ-юрисконсульта к договору по заказу.
 *
 * Требование владельца 07.10.2026: «каждый договор должен быть прокомментирован
 * нашим ИИ-юристом, такая роль уже заведена в компании». Роль — Лев, главный
 * ИИ-юрисконсульт (lib/agents-catalog.ts): он проверяет договор по матрице
 * рисков, отмечает опасные места и предлагает безопасные формулировки.
 *
 * Замечание — не запрет: договор составляется и отправляется в любом случае,
 * менеджер лишь видит, на что обратить внимание. Решение за человеком.
 */
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { cutForAi } from '@/lib/email/classify';

export interface ContractReview {
    /** Короткий вывод одной строкой: на что смотреть. */
    summary: string;
    /** Замечания по пунктам. Пусто — замечаний нет. */
    notes: string[];
    /** Насколько всё серьёзно: 'ok' | 'attention' | 'risk'. */
    level: 'ok' | 'attention' | 'risk';
    /** Замечания составил ИИ; false — он недоступен, и это заглушка. */
    byAi: boolean;
}

const PROMPT = `Ты Лев — главный ИИ-юрисконсульт завода металлических конструкций.
Проверяешь договор поставки, который менеджер отдела продаж собирается отправить клиенту.

Смотри на то, что действительно может навредить нам:
— сроки оплаты и порядок расчётов: не остаёмся ли мы без денег после отгрузки;
— сроки изготовления и поставки: выполнимы ли, есть ли запас;
— ответственность и неустойки: не выше ли они обычных, нет ли односторонних;
— подсудность и порядок споров;
— пустые или незаполненные места, где должны быть данные;
— расхождения между разделами договора.

Пиши коротко и по делу, на русском, без юридического тумана. Менеджер — не юрист.
Если всё в порядке, так и скажи — не придумывай замечаний на пустом месте.

Ответ строго в JSON:
{"level":"ok|attention|risk","summary":"одна строка","notes":["замечание", "..."]}
level: ok — отправляй как есть; attention — стоит глянуть; risk — лучше показать живому юристу.`;

/** Пройтись по тексту договора и вернуть замечания. */
export async function reviewContract(contractText: string): Promise<ContractReview> {
    if (!isOpenAIConfigured() || !contractText.trim()) {
        return {
            summary: 'ИИ-юрисконсульт недоступен — договор не проверен.',
            notes: [],
            level: 'attention',
            byAi: false,
        };
    }

    try {
        const client = getOpenAIClient();
        const res = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: PROMPT },
                { role: 'user', content: cutForAi(contractText, 14000) },
            ],
        });

        const raw = res.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as Partial<ContractReview>;

        const level = parsed.level === 'risk' || parsed.level === 'ok' ? parsed.level : 'attention';
        return {
            summary: String(parsed.summary ?? '').trim() || 'Замечаний нет.',
            notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).filter(Boolean).slice(0, 10) : [],
            level,
            byAi: true,
        };
    } catch (e: any) {
        console.error('[contract-review] не получилось проверить договор:', e?.message);
        return {
            summary: 'Проверить договор не удалось — попробуйте ещё раз.',
            notes: [],
            level: 'attention',
            byAi: false,
        };
    }
}
