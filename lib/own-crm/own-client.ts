/**
 * Карточка клиента в нашей базе: найти или завести.
 *
 * Заявка приходит письмом, из чата или заводится руками — клиент должен
 * оказаться в нашей базе, а не только в RetailCRM. Из-за этого в заказе 1039А
 * компания и реквизиты были пустыми: карточка существовала в RetailCRM, а у нас
 * её не было (разбор 02.10.2026).
 *
 * Правило поиска — решение владельца 02.10.2026:
 *   1. Совпал ИНН — это тот же контрагент, берём его.
 *   2. ИНН нет, но совпали название компании и почта или телефон — тот же.
 *   3. Не нашли — заводим новую карточку у себя.
 *
 * Почему не по одному признаку: общий ящик посредника висит на десятках юрлиц
 * (srpm@srpm.ru — 18 карточек), а название в CRM пишут как попало. Поодиночке
 * они плодят дубли, и постоянный клиент выглядит новым в зарплате (разбор
 * ПромСтоун, 8 карточек на одно юрлицо).
 *
 * В RetailCRM такие карточки не уходят: курс на свою CRM. Чтобы их было видно
 * при сверке, помечаем источник `own-crm`.
 */
import { supabase } from '@/utils/supabase';
import { normalizeCompanyName, normalizePhone, pickCustomerMatch, type CorporateCandidate } from '@/lib/retailcrm/customer-binding';

/** Свои карточки нумеруем с запасом от номеров RetailCRM, как и свои заказы. */
export const OWN_CLIENT_ID_BASE = 900_000_000;

export type ClientHints = {
    inn?: string | null;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
    contactName?: string | null;
};

export type ResolvedClient = {
    id: number;
    created: boolean;
    /** Человеческим языком: как нашли или почему завели — для истории заказа. */
    reason: string;
};

const clean = (value: unknown): string => String(value ?? '').trim();

/** Следующий номер своей карточки клиента. */
async function nextOwnClientId(): Promise<number> {
    const { data } = await supabase
        .from('clients')
        .select('id')
        .gte('id', OWN_CLIENT_ID_BASE)
        .order('id', { ascending: false })
        .limit(1);
    const last = Number((data as any[])?.[0]?.id ?? OWN_CLIENT_ID_BASE);
    return Math.max(last + 1, OWN_CLIENT_ID_BASE + 1);
}

/** Карточка по ИНН — самый надёжный ключ. */
async function findByInn(inn: string): Promise<number | null> {
    const digits = inn.replace(/\D/g, '');
    if (!digits) return null;
    const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('inn', digits)
        .order('orders_count', { ascending: false })
        .limit(1);
    const id = (data as any[])?.[0]?.id;
    return id ? Number(id) : null;
}

/** Кандидаты по контактам: почта или телефон. Название сверяем отдельно. */
async function findByContacts(email: string, phone: string): Promise<CorporateCandidate[]> {
    const candidates = new Map<number, CorporateCandidate>();

    const add = (rows: any[], matchedBy: 'почта' | 'телефон') => {
        for (const row of rows || []) {
            const existing = candidates.get(Number(row.id));
            if (existing) {
                if (!existing.matchedBy.includes(matchedBy)) existing.matchedBy.push(matchedBy);
                continue;
            }
            candidates.set(Number(row.id), {
                id: Number(row.id),
                name: row.company_name || row.legalName || null,
                ordersCount: Number(row.orders_count ?? 0),
                matchedBy: [matchedBy],
            });
        }
    };

    if (email) {
        const { data } = await supabase
            .from('clients')
            .select('id, company_name, legalName, orders_count')
            .or(`email.ilike.${email},contact_email.ilike.${email}`)
            .limit(40);
        add(data as any[], 'почта');
    }

    /**
     * Телефон — подтверждение, а не отдельный поиск: колонка `phones` массив, и
     * номера в ней записаны как попало («+7 846…», «8(846)…»). Поэтому сверяем
     * последние десять цифр уже у найденных карточек.
     */
    const digits = normalizePhone(phone);
    if (digits) {
        const tail = digits.slice(-10);
        for (const candidate of Array.from(candidates.values())) {
            const { data } = await supabase
                .from('clients')
                .select('phones')
                .eq('id', candidate.id)
                .maybeSingle();
            const numbers = ((data as any)?.phones || []) as unknown[];
            const matched = numbers.some((n) => String(n ?? '').replace(/\D/g, '').endsWith(tail));
            if (matched && !candidate.matchedBy.includes('телефон')) candidate.matchedBy.push('телефон');
        }
    }

    return Array.from(candidates.values());
}

/**
 * Находит карточку клиента или заводит новую. Возвращает её номер — его и
 * кладём в заказ.
 */
export async function findOrCreateOwnClient(hints: ClientHints): Promise<ResolvedClient | null> {
    const inn = clean(hints.inn).replace(/\D/g, '');
    const companyName = clean(hints.companyName);
    const email = clean(hints.email).toLowerCase();
    const phone = clean(hints.phone);
    const contactName = clean(hints.contactName);

    // Совсем без признаков карточку не заводим: получится пустая строка в базе.
    if (!inn && !companyName && !email && !phone) return null;

    if (inn) {
        const byInn = await findByInn(inn);
        if (byInn) return { id: byInn, created: false, reason: `Клиент найден по ИНН ${inn}` };
    }

    if (companyName) {
        const candidates = await findByContacts(email, phone);
        const match = pickCustomerMatch(companyName, candidates);
        if (match.chosen) {
            return {
                id: match.chosen.id,
                created: false,
                reason: `Клиент найден по названию и ${match.chosen.matchedBy.join(' и ')}`,
            };
        }
    }

    const id = await nextOwnClientId();
    const { error } = await supabase.from('clients').insert({
        id,
        company_name: companyName || null,
        legalName: companyName || null,
        inn: inn || null,
        email: email || null,
        contact_email: email || null,
        // Колонка — массив: храним так же, как приехавшие из RetailCRM карточки.
        phones: phone ? [phone] : null,
        contact_name: contactName || null,
        is_corporate: true,
        // Карточка наша: в RetailCRM она не уходит, и при сверке это видно.
        source: 'own-crm',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });

    if (error) {
        console.error('[own-client] карточка не завелась:', error);
        return null;
    }

    const title = companyName || contactName || email || phone;
    return { id, created: true, reason: `Заведена карточка клиента: ${title}` };
}

/** Нормализованное название — пригодится вызывающим для логов и сверки. */
export { normalizeCompanyName };
