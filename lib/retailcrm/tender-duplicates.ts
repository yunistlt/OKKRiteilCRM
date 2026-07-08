import { supabase } from '@/utils/supabase';

const STOP_WORDS = new Set([
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так',
    'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было',
    'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'тоже', 'абы', 'без', 'этого', 'эти', 'этом',
    'для', 'какой', 'себя', 'под', 'может', 'или', 'тут', 'где', 'есть', 'надо', 'ней', 'мы',
    'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'будто', 'чего', 'раз', 'себе', 'был', 'будет',
    'будут', 'это', 'при', 'после', 'этой', 'этого', 'этим', 'этими', 'этих', 'этом',
    'добрый', 'день', 'прошу', 'выставить', 'счет', 'указать', 'срок', 'поставка', 'доставка',
    'подскажите', 'пожалуйста', 'здравствуйте', 'письма', 'заявка', 'запрос', 'тема', 'вложения',
    'email', 'телефон', 'номер', 'клиент', 'менеджер', 'заказ', 'вложение', 'текст', 'принята', 'секретарем',
    'dear', 'hello', 'please', 'find', 'attached', 'thank', 'you', 'regards', 'best'
]);

function tokenize(text: string): Set<string> {
    const normalized = text.toLowerCase();
    const tokens = normalized.match(/[a-z0-9а-яё-]+/gi) || [];
    const result = new Set<string>();
    for (const t of tokens) {
        if (t.length >= 3 && !STOP_WORDS.has(t)) {
            result.add(t);
        }
    }
    return result;
}

function calculateOverlap(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersectionSize = 0;
    for (const item of setA) {
        if (setB.has(item)) {
            intersectionSize++;
        }
    }
    return intersectionSize / Math.min(setA.size, setB.size);
}

function extractCity(address: string): string | null {
    if (!address) return null;
    const clean = address.toLowerCase();
    const match = clean.match(/(?:г\.|город|г\.п\.|п\.|поселок)\s*([a-яё-]+)/i) 
               || clean.match(/(санкт-петербург|спб|москва|тольятти|самара|нижний новгород|екатеринбург|казань)/i);
    if (match) {
        let city = match[1] || match[0];
        if (city === 'спб') return 'санкт-петербург';
        return city.trim().toLowerCase();
    }
    return null;
}

function extractFilenamesFromComment(comment: string): string[] {
    const match = comment.match(/(?:📎 Вложения|Вложения): (.*)/i);
    if (!match) return [];
    return match[1].toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

export async function findTenderDuplicate(params: {
    bodyText: string;
    attachmentText: string;
    attachmentNames: string[];
    deliveryAddress?: string | null;
    excludeNumber?: string;
}): Promise<{ refOrderId: number; refOrderNumber: string; managerId: number } | null> {
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // Выбираем только заказы за последние 30 дней, чтобы избежать таймаутов
    const { data: pastOrders, error } = await supabase
        .from('orders')
        .select('id, number, manager_id, status, raw_payload')
        .gte('created_at', oneMonthAgo);

    if (error || !pastOrders || pastOrders.length === 0) {
        if (error) console.error('Error fetching past orders for duplicate search:', error);
        return null;
    }

    const newText = `${params.bodyText} ${params.attachmentText} ${params.attachmentNames.join(' ')}`;
    const newTokens = tokenize(newText);
    if (newTokens.size === 0) return null;

    const newDeliveryCity = extractCity(params.deliveryAddress || '');

    let bestMatch: { order: any; score: number } | null = null;

    for (const order of pastOrders) {
        if (params.excludeNumber && order.number === params.excludeNumber) {
            continue;
        }

        const raw = order.raw_payload;
        if (!raw) continue;

        const pastComment = raw.customerComment || '';
        const pastManagerComment = raw.managerComment || '';
        
        // Извлекаем имена товаров из офферов заказа
        const items = raw.items || [];
        const pastItems = items.map((it: any) => {
            return `${it.offer?.name || it.offer?.displayName || it.productName || it.name || ''}`;
        }).join(' ');

        const pastText = `${pastComment} ${pastManagerComment} ${pastItems}`;
        const pastTokens = tokenize(pastText);

        const overlap = calculateOverlap(newTokens, pastTokens);

        // Проверяем точное совпадение имен файлов
        let filenameMatch = false;
        if (params.attachmentNames.length > 0) {
            const pastFilenames = extractFilenamesFromComment(pastComment);
            for (const name of params.attachmentNames) {
                if (pastFilenames.includes(name.toLowerCase())) {
                    filenameMatch = true;
                    break;
                }
            }
        }

        // Проверяем совпадение города доставки
        const pastDeliveryAddress = raw.delivery?.address?.text || raw.delivery?.address?.city || '';
        const pastDeliveryCity = extractCity(pastDeliveryAddress);
        const cityMatch = newDeliveryCity && pastDeliveryCity && newDeliveryCity === pastDeliveryCity;

        // Рассчитываем итоговый балл сходства
        let score = overlap;
        if (filenameMatch) score += 0.4;
        if (cityMatch) score += 0.2;

        // Если в новом тексте присутствуют все товары оригинального заказа, даем бонус
        if (items.length > 0) {
            let itemsMatched = 0;
            for (const it of items) {
                const prodName = (it.offer?.name || it.offer?.displayName || it.productName || it.name || '').toLowerCase().trim();
                if (prodName && newText.toLowerCase().includes(prodName)) {
                    itemsMatched++;
                }
            }
            const itemsMatchRatio = itemsMatched / items.length;
            score += itemsMatchRatio * 0.3;
        }

        if (score > 0.65 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { order, score };
        }
    }

    if (bestMatch) {
        console.log(`[Tender Duplicate] Found duplicate order #${bestMatch.order.number} with score ${bestMatch.score.toFixed(2)}`);
        
        let targetOrder = bestMatch.order;
        
        // Если найденный заказ сам является дубликатом, рекурсивно ищем первоисточник (оригинал)
        if (targetOrder.status === 'dubl-na-tender') {
            const managerComment = targetOrder.raw_payload?.managerComment || '';
            const match = managerComment.match(/(?:дубль|дубл|dubl)\D*(\d{3,6})/i);
            if (match) {
                const refNum = match[1];
                console.log(`[Tender Duplicate] Matched order #${targetOrder.number} is a duplicate. Resolving original order #${refNum}...`);
                const { data: refOrders } = await supabase
                    .from('orders')
                    .select('id, number, manager_id, status, raw_payload')
                    .eq('number', refNum)
                    .limit(1);
                if (refOrders && refOrders.length > 0) {
                    targetOrder = refOrders[0];
                    console.log(`[Tender Duplicate] Resolved original root order #${targetOrder.number}`);
                }
            }
        }

        const managerId = targetOrder.manager_id || targetOrder.raw_payload?.managerId;
        
        return {
            refOrderId: Number(targetOrder.id),
            refOrderNumber: targetOrder.number,
            managerId: Number(managerId)
        };
    }
    return null;
}
