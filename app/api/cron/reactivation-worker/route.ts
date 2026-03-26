/**
 * GET /api/cron/reactivation-worker
 * Агент-Писатель: берёт 5 клиентов из очереди, изучает карточку,
 * генерирует письмо по настройкам кампании и записывает в RetailCRM.
 *
 * ⚠️ Все настройки (промпт, тема письма) берутся из campaign.settings — не из кода.
 */

import { NextResponse } from 'next/server';
import { generateReactivationEmail } from '@/lib/reactivation';
import {
    getPendingLogs,
    setLogsProcessing,
    markLogSent,
    markLogError,
    getCampaignById,
    OutreachLog,
    CampaignSettings,
} from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';
const RETAILCRM_SITE = process.env.RETAILCRM_SITE ?? '';
const BATCH_SIZE = 5;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    const results: Array<{ customer_id: number; status: string; error?: string }> = [];

    try {
        const pending = await getPendingLogs(BATCH_SIZE);
        if (pending.length === 0) {
            return NextResponse.json({ success: true, processed: 0, message: 'Queue is empty' });
        }

        await setLogsProcessing(pending.map(l => l.id));

        for (const log of pending) {
            try {
                // Настройки кампании для этого лога
                const campaign = await getCampaignById(log.campaign_id);
                const settings: CampaignSettings = campaign?.settings ?? {};

                const emailText = await processCustomer(log, settings);
                await markLogSent(log.id, emailText);
                results.push({ customer_id: log.customer_id, status: 'sent' });
            } catch (e: any) {
                console.error(`[ReactivationWorker] Customer ${log.customer_id} failed:`, e);
                await markLogError(log.id, e.message ?? String(e));
                results.push({ customer_id: log.customer_id, status: 'error', error: e.message });
            }
        }

        return NextResponse.json({ success: true, processed: results.length, results });

    } catch (e: any) {
        console.error('[ReactivationWorker] Fatal error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────
// Обработка одного клиента
// ─────────────────────────────────────────────────────

async function processCustomer(log: OutreachLog, settings: CampaignSettings): Promise<string> {
    const customerId = log.customer_id;

    // 1. Карточка клиента
    const customerRes = await retailcrmFetch(`/api/v5/customers/${customerId}`);
    const customer = customerRes.customer ?? {};

    // 2. История заказов (последние 10)
    const ordersRes = await retailcrmFetch(
        `/api/v5/orders?filter[customerId]=${customerId}&limit=10&page=1`
    );
    const orders: any[] = ordersRes.orders ?? [];

    // 3. Контекст для ИИ
    const company_name =
        (log.company_name
        ?? customer.company
        ?? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim())
        || `Клиент #${customerId}`;

    const orders_history = orders.length > 0
        ? orders.map((o, i) => {
            const items = (o.items ?? [])
                .map((it: any) => it.offer?.name ?? it.productName ?? '')
                .filter(Boolean).join(', ');
            return `${i + 1}. Заказ #${o.number} | Статус: ${o.status} | Товары: ${items || '—'} | Сумма: ${o.totalSumm ?? 0} ₽`;
        }).join('\n')
        : 'История заказов отсутствует';

    const manager_comments = orders
        .filter(o => o.managerComment)
        .slice(0, 5)
        .map(o => `[Заказ #${o.number}]: ${o.managerComment}`)
        .join('\n') || '(комментарии менеджеров отсутствуют)';

    // 4. Генерировать письмо (промпт из настроек кампании)
    const emailText = await generateReactivationEmail({
        company_name,
        orders_history,
        manager_comments,
        custom_prompt: settings.victoria_prompt, // из админки
    });

    // 5. Email клиента
    const customerEmail = log.customer_email
        ?? customer.email
        ?? customer.emails?.[0]?.email;

    if (!customerEmail) {
        throw new Error(`No email found for customer ${customerId}`);
    }

    // 6. Номер последнего заказа для темы письма
    const lastOrderNumber = orders[0]?.number ?? orders[0]?.id ?? null;

    // 7. Записать в RetailCRM (кастомные поля → триггер отправляет письмо)
    await updateCustomerFields(customerId, emailText, lastOrderNumber);

    return emailText;
}

// Записать текст письма и номер заказа в кастомные поля клиента.
// RetailCRM-триггер на изменение поля ai_reactivation_text отправит письмо.
async function updateCustomerFields(
    customerId: number,
    emailBody: string,
    lastOrderNumber?: string | number | null
): Promise<void> {
    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    if (RETAILCRM_SITE) params.set('site', RETAILCRM_SITE);
    params.set('customer[customFields][ai_reactivation_text]', emailBody);
    if (lastOrderNumber) {
        params.set('customer[customFields][ai_last_order_number]', String(lastOrderNumber));
    }

    const url = `${RETAILCRM_URL}/api/v5/customers/${customerId}/edit`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`RetailCRM customer/edit failed: ${res.status} — ${errText.substring(0, 300)}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`RetailCRM customer/edit success:false — ${JSON.stringify(data)}`);
    }
}

async function retailcrmFetch(path: string): Promise<any> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${RETAILCRM_URL}${path}${sep}apiKey=${RETAILCRM_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RetailCRM ${path} → HTTP ${res.status}`);
    return res.json();
}
