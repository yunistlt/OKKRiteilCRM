/**
 * «Досье» к письму для Катерины: детерминированный сбор фактов из нашей базы ДО вызова AI.
 *
 * Зачем: модель решает маршрут только по тексту письма и ошибается там, где нужен факт из CRM.
 * Инцидент 04.08.2026: уведомление магазина «Новый заказ 1005469» ушло в бухгалтерию как
 * «письмо про уже существующую сделку» — хотя заказа 1005469 в CRM нет и не было; заявка потеряна.
 *
 * Что собираем (только проверяемые факты, без выводов):
 *  - номера-кандидаты из темы и тела → есть ли такой заказ в CRM (дата, статус, сумма, менеджер, состав);
 *  - клиент по e-mail (из From или из тела письма-робота) → сколько у него заказов и когда последний;
 *  - как раньше классифицировались письма с этого адреса.
 *
 * Всё, что не нашлось, попадает в досье явным «НЕ найден» — отрицательный факт для модели важнее молчания.
 * Ошибки БД глушим: досье — усиление, а не обязательное условие классификации.
 */
import { supabase } from '@/utils/supabase';
import { formatRub } from '@/lib/format';

/** Сколько номеров-кандидатов проверяем в CRM (защита от письма, набитого цифрами). */
const MAX_ORDER_CANDIDATES = 5;
/** Сколько позиций заказа показываем в справке. */
const MAX_ITEMS_SHOWN = 5;

export interface DossierInput {
    fromEmail?: string | null;
    subject?: string | null;
    /** Готовый текст письма (plain или уже вытащенный из HTML). */
    body?: string | null;
    /** E-mail реального клиента, если From — робот (webasyst и т.п.). */
    contactEmail?: string | null;
    /**
     * id письма, которое сейчас разбираем. Исключается из истории адреса: иначе при
     * переразборе (переочередь) досье подсовывает модели её же прошлый вердикт по этому
     * же письму, и ошибка воспроизводится сама — «прошлые письма: accounting».
     */
    excludeEmailId?: string | null;
}

interface OrderFact {
    number: string;
    createdAt: string | null;
    statusName: string;
    totalSum: number | null;
    managerName: string | null;
    items: string[];
}

/**
 * Номера-кандидаты «заказа» из темы и начала тела. Берём и «голые» числа из темы
 * (у писем магазина тема ровно «Новый заказ 1005469»), и числа после ключевых слов в теле.
 * Порядок: тема важнее тела; дубли убираем.
 */
export function extractOrderCandidates(subject?: string | null, body?: string | null): string[] {
    const out: string[] = [];
    const push = (n?: string | null) => {
        const v = (n || '').trim();
        if (v && !out.includes(v)) out.push(v);
    };
    const collect = (text: string, re: RegExp) => {
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) push(m[1]);
    };
    const keyed = () => /(?:заказ[а-я]*|счет[а-я]*|счёт[а-я]*|№|order|invoice)\s*[№#]?\s*(\d{4,7})/gi;
    collect(subject || '', keyed());
    collect(subject || '', /(?:^|[^\d.,])(\d{4,7})(?![\d.,])/g);
    collect((body || '').slice(0, 2000), keyed());
    return out.slice(0, MAX_ORDER_CANDIDATES);
}

/** Человеческое название статуса заказа из справочника RetailCRM (коды в UI не показываем). */
async function statusNames(codes: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniq = Array.from(new Set(codes.filter(Boolean)));
    if (!uniq.length) return map;
    try {
        const { data } = await supabase
            .from('retailcrm_dictionaries')
            .select('item_code, item_name')
            .eq('entity_type', 'status')
            .in('item_code', uniq);
        for (const r of data || []) if (r.item_code) map.set(r.item_code, r.item_name || r.item_code);
    } catch {
        /* справочник недоступен — покажем код как есть */
    }
    return map;
}

/** Позиции заказа из raw_payload (название × количество) — по ним видно, наша ли это продукция. */
function itemLines(payload: any): string[] {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.slice(0, MAX_ITEMS_SHOWN).map((it: any) => {
        const name = it?.offer?.displayName || it?.offer?.name || it?.productName || 'позиция без названия';
        const qty = Number(it?.quantity) || 0;
        return qty ? `${name} × ${qty}` : String(name);
    });
}

/** Ищет заказы по номерам-кандидатам. Возвращает найденные факты (ненайденные — просто отсутствуют). */
async function findOrders(numbers: string[]): Promise<OrderFact[]> {
    if (!numbers.length) return [];
    let rows: any[] = [];
    try {
        const { data } = await supabase
            .from('orders')
            .select('number, status, created_at, totalsumm, manager_id, raw_payload')
            .in('number', numbers);
        rows = data || [];
    } catch {
        return [];
    }
    if (!rows.length) return [];

    const [names, managers] = await Promise.all([
        statusNames(rows.map((r) => r.status)),
        (async () => {
            const ids = Array.from(new Set(rows.map((r) => r.manager_id).filter(Boolean)));
            const map = new Map<number, string>();
            if (!ids.length) return map;
            try {
                const { data } = await supabase.from('managers').select('id, first_name, last_name').in('id', ids);
                for (const m of data || []) map.set(m.id, [m.last_name, m.first_name].filter(Boolean).join(' ').trim());
            } catch {
                /* без имени менеджера справка тоже полезна */
            }
            return map;
        })(),
    ]);

    return rows.map((r) => ({
        number: String(r.number),
        createdAt: r.created_at ? String(r.created_at).slice(0, 10) : null,
        statusName: names.get(r.status) || r.status || 'статус неизвестен',
        totalSum: r.totalsumm != null ? Number(r.totalsumm) : null,
        managerName: r.manager_id ? managers.get(r.manager_id) || null : null,
        items: itemLines(r.raw_payload),
    }));
}

/** История клиента: сколько заказов и когда последний. E-mail ищем в raw_payload (contact/customer). */
async function clientHistory(email: string): Promise<{ count: number; last: { number: string; createdAt: string | null } | null } | null> {
    if (!email) return null;
    try {
        const { data } = await supabase
            .from('orders')
            .select('number, created_at')
            .or(`raw_payload->>email.eq.${email},raw_payload->contact->>email.eq.${email},raw_payload->customer->>email.eq.${email}`)
            .order('created_at', { ascending: false })
            .limit(50);
        const rows = data || [];
        if (!rows.length) return { count: 0, last: null };
        return {
            count: rows.length,
            last: { number: String(rows[0].number), createdAt: rows[0].created_at ? String(rows[0].created_at).slice(0, 10) : null },
        };
    } catch {
        return null;
    }
}

/** Как раньше разбирали письма с этого адреса (последние решения Катерины). */
async function senderHistory(email: string, excludeId?: string | null): Promise<string[]> {
    if (!email) return [];
    try {
        let q = supabase
            .from('incoming_emails')
            .select('email_type, received_at')
            .eq('from_email', email)
            .not('email_type', 'is', null);
        if (excludeId) q = q.neq('id', excludeId); // себя в свою же историю не подаём
        const { data } = await q
            .order('received_at', { ascending: false })
            .limit(5);
        return (data || []).map((r: any) => `${String(r.received_at || '').slice(0, 10)}: ${r.email_type}`);
    } catch {
        return [];
    }
}

/**
 * Собирает досье и рендерит его текстовым блоком для user-сообщения классификатора.
 * Возвращает пустую строку, если ничего проверить не удалось.
 */
export async function buildCrmDossier(input: DossierInput): Promise<string> {
    const candidates = extractOrderCandidates(input.subject, input.body);
    const clientEmail = (input.contactEmail || input.fromEmail || '').trim().toLowerCase();

    const [orders, history, prior] = await Promise.all([
        findOrders(candidates),
        clientHistory(clientEmail),
        senderHistory((input.fromEmail || '').trim().toLowerCase(), input.excludeEmailId),
    ]);

    const lines: string[] = [];

    if (candidates.length) {
        for (const num of candidates) {
            const found = orders.find((o) => o.number === num);
            if (!found) {
                lines.push(`- Номер ${num}: заказа с таким номером в CRM НЕТ.`);
                continue;
            }
            const parts = [
                `- Номер ${num}: заказ НАЙДЕН`,
                found.createdAt ? `создан ${found.createdAt}` : null,
                `статус «${found.statusName}»`,
                found.totalSum != null ? `сумма ${formatRub(found.totalSum)}` : null,
                found.managerName ? `менеджер ${found.managerName}` : null,
            ].filter(Boolean);
            lines.push(parts.join(', ') + '.');
            if (found.items.length) lines.push(`  Состав: ${found.items.join('; ')}.`);
        }
    } else {
        lines.push('- Номеров заказа в письме не найдено.');
    }

    if (clientEmail) {
        if (!history) {
            lines.push(`- Клиент ${clientEmail}: проверить не удалось.`);
        } else if (history.count === 0) {
            lines.push(`- Клиент ${clientEmail}: заказов в CRM НЕТ (новый контакт).`);
        } else {
            const last = history.last;
            lines.push(
                `- Клиент ${clientEmail}: заказов в CRM ${history.count}${last ? `, последний №${last.number}${last.createdAt ? ` от ${last.createdAt}` : ''}` : ''}.`
            );
        }
    }

    if (prior.length) lines.push(`- Прошлые письма с адреса ${input.fromEmail}: ${prior.join('; ')}.`);

    if (!lines.length) return '';

    return `СПРАВКА ИЗ CRM (собрана кодом по нашей базе, это проверенные факты — доверяй им больше, чем формулировкам письма):
${lines.join('\n')}`;
}
