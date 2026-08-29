import { supabase } from '@/utils/supabase';
import { getCrmConfig } from '@/lib/retailcrm/leads';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';

// Глубокое досье клиента: всё, что о нём известно, плюс кто он снаружи.
//
// Поверхностный анализ выдаёт «предложите ещё сушильные шкафы». Глубокий должен
// отвечать на другие вопросы: что это за компания, как менялись её закупки, о
// чём говорили в последних разговорах, чего она ждёт и почему тормозит.
//
// Внешний источник у нас один и надёжный: домен из почты контактного лица.
// Гадать по названию нельзя — «Альянс» в России тысяча штук, — а домен указывает
// на конкретную компанию. Проверки по ИНН в проекте нет: lib/legal-counterparty-check
// до сих пор заглушка, и притворяться, что она работает, хуже, чем не иметь её.

export type ClientProfile = {
    clientKey: string;
    name: string;
    inn: string | null;
    sphere: string | null;
    crmCustomerIds: number[];
    ordersTotal: number;
    amountTotal: number;
    firstOrder: string | null;
    lastOrder: string | null;
    byYear: Record<string, number>;
    byCategory: Record<string, number>;
    wonOrders: Array<{ number: string; date: string; amount: number; status: string }>;
    lostOrders: Array<{ number: string; date: string; amount: number; status: string; reason: string | null }>;
    comments: Array<{ date: string; order: string; text: string }>;
    calls: Array<{ date: string; order: string | null; transcript: string }>;
    site: string | null;
    siteSummary: string | null;
};

/** Домен почты → сайт компании. Единственный внешний след, которому можно верить. */
export function siteFromEmails(emails: string[]): string | null {
    const skip = new Set([
        'gmail.com', 'mail.ru', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru', 'list.ru',
        'rambler.ru', 'icloud.com', 'outlook.com', 'hotmail.com', 'internet.ru', 'yahoo.com',
    ]);
    for (const email of emails) {
        const domain = String(email).split('@')[1]?.toLowerCase().trim();
        if (!domain || skip.has(domain)) continue;
        return `https://${domain}`;
    }
    return null;
}

/** Что за компания — по её сайту. Ошибка сети здесь не повод рушить досье. */
export async function fetchSiteSummary(site: string): Promise<string | null> {
    try {
        const res = await fetch(site, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZMK-CRM/1.0)' },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const html = await res.text();

        // Из HTML достаём только текст: скрипты и стили в контекст модели не нужны.
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return text.slice(0, 4000) || null;
    } catch {
        return null;
    }
}

export async function buildClientProfile(clientKey: string): Promise<ClientProfile | null> {
    const { data: base } = await supabase.rpc('sales_client_dossier', { p_client_key: clientKey });
    const d = ((base ?? []) as any[])[0];
    if (!d) return null;

    const { data: deep } = await supabase.rpc('sales_client_deep', { p_client_key: clientKey });
    const extra = ((deep ?? []) as any[])[0] ?? {};

    const emails: string[] = extra.emails ?? [];
    const site = siteFromEmails(emails);

    return {
        clientKey,
        name: d.client_name ?? '',
        inn: clientKey.startsWith('cid:') ? null : clientKey,
        sphere: d.sphere_name ?? null,
        crmCustomerIds: extra.customer_ids ?? [],
        ordersTotal: Number(d.orders_count ?? 0),
        amountTotal: Number(d.total_amount ?? 0),
        firstOrder: d.first_order ? String(d.first_order).slice(0, 10) : null,
        lastOrder: d.last_order ? String(d.last_order).slice(0, 10) : null,
        byYear: d.by_year ?? {},
        byCategory: d.by_category ?? {},
        wonOrders: extra.won_orders ?? [],
        lostOrders: extra.lost_orders ?? [],
        comments: extra.comments ?? [],
        calls: extra.calls ?? [],
        site,
        siteSummary: site ? await fetchSiteSummary(site) : null,
    };
}

/** Текст досье для модели: длинный и подробный — на нём строится глубина. */
export function renderClientProfile(p: ClientProfile): string {
    const money = (v: number) => Math.round(v).toLocaleString('ru-RU');
    const lines: string[] = [
        `Клиент: ${p.name}${p.inn ? ` (ИНН ${p.inn})` : ''}`,
        `Сфера: ${p.sphere ?? 'не указана'}`,
        `Покупок: ${p.ordersTotal} на ${money(p.amountTotal)} ₽, первая ${p.firstOrder}, последняя ${p.lastOrder}`,
        `По годам: ${Object.entries(p.byYear).map(([y, s]) => `${y} — ${money(Number(s))} ₽`).join('; ') || 'нет'}`,
        `Категории: ${Object.entries(p.byCategory).map(([c, n]) => `${c} (${n})`).join('; ') || 'нет'}`,
    ];

    if (p.lostOrders.length > 0) {
        lines.push(
            '',
            'Незакрытые и потерянные сделки (по ним видно, где мы не дожали):',
            ...p.lostOrders.slice(0, 10).map(
                (o) => `— №${o.number} от ${o.date}, ${money(o.amount)} ₽, статус «${o.status}»${o.reason ? `, причина: ${o.reason}` : ''}`,
            ),
        );
    }

    if (p.comments.length > 0) {
        lines.push('', 'Комментарии менеджеров по заказам (хроника переговоров):');
        for (const c of p.comments.slice(0, 12)) lines.push(`— ${c.date}, заказ №${c.order}: ${c.text}`);
    }

    if (p.calls.length > 0) {
        lines.push('', 'Расшифровки разговоров:');
        for (const c of p.calls.slice(0, 5)) {
            lines.push(`[${c.date}${c.order ? `, заказ №${c.order}` : ''}]\n${c.transcript}`);
        }
    }

    if (p.siteSummary) {
        lines.push('', `Сайт компании (${p.site}) — что она сама о себе пишет:`, p.siteSummary);
    } else if (p.site) {
        lines.push('', `Сайт ${p.site} не открылся — о самой компании судить не по чему.`);
    }

    return lines.join('\n');
}

// ── сводка моделью и запись в карточку клиента ────────────────────────────────

export type ClientSummary = { text: string; model: string | null };

/**
 * Глубокий разбор клиента.
 *
 * Отдаём модели всё досье целиком и просим сводку, которую прочитает менеджер,
 * открыв карточку. Промпт лежит в базе: такие тексты правятся по живым примерам,
 * а не по замыслу.
 */
export async function summarizeClient(clientKey: string): Promise<ClientSummary | null> {
    if (!isOpenAIConfigured()) return null;

    const profile = await buildClientProfile(clientKey);
    if (!profile) return null;

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_client_summary')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return null;

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: prompt.model || 'gpt-4o',
        temperature: Number(prompt.temperature ?? 0.3),
        max_tokens: Number(prompt.max_tokens ?? 1200),
        messages: [
            { role: 'system', content: prompt.system_prompt },
            { role: 'user', content: renderClientProfile(profile) },
        ],
    });

    await recordAiUsage({
        agentId: AiAgent.SALES_ANALYST,
        model: completion.model,
        usage: completion.usage,
        purpose: 'sales_client_summary',
    }).catch(() => null);

    const text = (completion.choices[0]?.message?.content || '').trim();
    return text ? { text, model: completion.model } : null;
}

/**
 * Пишет сводку в карточку клиента RetailCRM.
 *
 * Поле ai_client_summary заведено отдельно и только для этого: писать разбор в
 * общий комментарий клиента нельзя — там переписка живых людей.
 */
export async function writeClientSummary(customerId: number, text: string, site: string | null): Promise<boolean> {
    const { url, key } = await getCrmConfig();
    const stamp = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const summary = `Разбор от ${stamp}${site ? ` (сайт: ${site})` : ''}\n\n${text}`;

    // У юрлиц своя сущность и свой эндпоинт: customers/{id} для них отвечает
    // «Not found», и без этого сводка молча не записывалась бы. Сначала пробуем
    // корпоративного клиента, потом обычного — тип заранее не известен.
    for (const entity of ['customers-corporate', 'customers'] as const) {
        const check = await fetch(`${url}/api/v5/${entity}/${customerId}?by=id`, { headers: { 'X-API-KEY': key } });
        const found = await check.json();
        if (!found.success) continue;

        const payloadKey = entity === 'customers-corporate' ? 'customerCorporate' : 'customer';
        // site обязателен и здесь. У клиента своего site нет — берём магазин из
        // его последнего заказа, а если заказов нет, настроечный по умолчанию.
        const { data: orderRow } = await supabase
            .from('orders')
            .select('site')
            .filter('raw_payload->customer->>id', 'eq', String(customerId))
            .not('site', 'is', null)
            .limit(1)
            .maybeSingle();

        const body = new URLSearchParams({
            [payloadKey]: JSON.stringify({ customFields: { ai_client_summary: summary } }),
            by: 'id',
            site: String(orderRow?.site || (await getCrmConfig()).site || ''),
        });

        const res = await fetch(`${url}/api/v5/${entity}/${customerId}/edit?apiKey=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = await res.json();
        if (data.success) return true;
        console.error(`Не удалось записать сводку (${entity}):`, JSON.stringify(data).slice(0, 300));
    }

    return false;
}
