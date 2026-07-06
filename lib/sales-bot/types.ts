// Типы ядра бота-продажника. Канало-независимы: один и тот же «мозг»
// обслуживает и чаты RetailCRM, и email.

export type DialogDomain =
    | 'продажа'
    | 'товар'
    | 'логистика_сроки'
    | 'рекламация'
    | 'возврат'
    | 'суд_претензия'
    | 'прочее';

// Домены, в которых боту разрешено отвечать самому (остальное — юристу).
export const BOT_DOMAINS: DialogDomain[] = ['продажа', 'товар', 'логистика_сроки'];
export const DISPUTE_DOMAINS: DialogDomain[] = ['рекламация', 'возврат', 'суд_претензия'];

export function isDisputeDomain(d: string): boolean {
    return (DISPUTE_DOMAINS as string[]).includes(d);
}

export type DialogHit = {
    slug: string;
    domain: string;
    type: string | null;
    bot_can_answer: boolean;
    situation: string;
    response: string;
    outcome: string | null;
    source_order: string | null;
    similarity: number;
};

export type SalesBotTurn = {
    role: 'client' | 'bot';
    text: string;
};

export type SalesBotInput = {
    message: string;
    history?: SalesBotTurn[];
    // Готовый контекст заказа (товар/доставка/сроки/сумма). Заполнит канальный/tool-слой.
    orderContext?: string | null;
};

export type SalesBotResult = {
    // reply — бот отвечает клиенту; escalate — спорная тема, передаём юристу.
    action: 'reply' | 'escalate';
    domain: DialogDomain;
    reply: string;
    escalateTo?: 'lawyer';
    knowledge: DialogHit[];
    // Диагностика для логов/отладки.
    meta: {
        routed: DialogDomain;
        escalated: boolean;
        knowledgeCount: number;
        promptKeys: string[];
    };
};
