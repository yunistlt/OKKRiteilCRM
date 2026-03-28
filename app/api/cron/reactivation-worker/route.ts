/**
 * GET /api/cron/reactivation-worker
 * Агент-Писатель: работает в два этапа.
 * 1. Генерация: Берёт 'pending', создаёт черновик + обоснование -> 'awaiting_approval'
 * 2. Отправка: Берёт 'approved', записывает в RetailCRM -> 'sent'
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { generateReactivationEmail } from '@/lib/reactivation';
import {
    getPendingLogs,
    getApprovedLogs,
    setLogsProcessing,
    markLogError,
    getCampaignById,
    OutreachLog,
    CampaignSettings,
} from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Увеличим до 2 минут, так как этапов два

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';
const RETAILCRM_SITE = process.env.RETAILCRM_SITE ?? '';
const BATCH_SIZE = 5;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    const results: Array<{ id: string; status: string; error?: string }> = [];

    try {
        // --- ЭТАП 1: ГЕНЕРАЦИЯ ЧЕРНОВИКОВ (PENDING -> AWAITING_APPROVAL) ---
        const pending = await getPendingLogs(BATCH_SIZE);
        if (pending.length > 0) {
            console.log(`[ReactivationWorker] Drafting ${pending.length} emails...`);
            await setLogsProcessing(pending.map(l => l.id));

            for (const log of pending) {
                try {
                    const campaign = await getCampaignById(log.campaign_id);
                    await processCustomer(log, campaign?.settings ?? {});
                    results.push({ id: log.id, status: 'awaiting_approval' });
                } catch (e: any) {
                    console.error(`[ReactivationWorker] Draft ${log.id} failed:`, e);
                    await markLogError(log.id, e.message ?? String(e));
                    results.push({ id: log.id, status: 'error', error: e.message });
                }
            }
        }

        // --- ЭТАП 2: ОТПРАВКА ОДОБРЕННЫХ (APPROVED -> SENT) ---
        const approved = await getApprovedLogs(BATCH_SIZE);
        if (approved.length > 0) {
            console.log(`[ReactivationWorker] Sending ${approved.length} approved emails...`);
            for (const log of approved) {
                try {
                    await sendApprovedEmail(log);
                    results.push({ id: log.id, status: 'sent' });
                } catch (e: any) {
                    console.error(`[ReactivationWorker] Sending ${log.id} failed:`, e);
                    await markLogError(log.id, e.message ?? String(e));
                    results.push({ id: log.id, status: 'error', error: e.message });
                }
            }
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            details: results
        });

    } catch (error: any) {
        console.error('[ReactivationWorker] Fatal Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────
// 🚀 ЛОГИКА АГЕНТА
// ─────────────────────────────────────────────────────

// ТАКТ 1: Генерация текста и обоснования
async function processCustomer(log: OutreachLog, settings: CampaignSettings): Promise<void> {
    const customerId = log.customer_id;

    // 1. Карточка корпоративного клиента
    const customerRes = await retailcrmFetch(`/api/v5/customers-corporate/${customerId}`);
    const customer = customerRes.customerCorporate ?? {};

    // 2. История заказов
    const ordersRes = await retailcrmFetch(
        `/api/v5/orders?filter[customerCorporate]=${customerId}&limit=10&page=1`
    );
    const orders: any[] = ordersRes.orders ?? [];

    const mainContact = customer.mainCustomerContact || (customer.contactPersons && customer.contactPersons[0]);
    const contactPersonName = mainContact ? `${mainContact.firstName ?? ''} ${mainContact.lastName ?? ''}`.trim() : undefined;

    // 3. Контекст из БД (LTV, Сфера, Категория)
    const { data: dbClient } = await supabase
        .from('clients')
        .select('orders_count, total_summ, average_check, category, industry, phones')
        .eq('id', customerId)
        .single();

    // 4. История звонков
    let call_transcripts = '';
    const clientPhones = dbClient?.phones || [];
    if (clientPhones.length > 0) {
        const { data: calls } = await supabase
            .from('raw_telphin_calls')
            .select('started_at, transcript')
            .or(`from_number_normalized.in.(${clientPhones.join(',')}),to_number_normalized.in.(${clientPhones.join(',')})`)
            .not('transcript', 'is', null)
            .order('started_at', { ascending: false })
            .limit(3);

        if (calls && (calls as any[]).length > 0) {
            call_transcripts = (calls as any[]).map(c => 
                `[${new Date(c.started_at).toLocaleDateString()}]: ${c.transcript.substring(0, 500)}...`
            ).join('\n\n');
        }
    }

    const company_name = customer.nickName || customer.legalName || log.company_name || `Клиент #${customerId}`;

    const orders_history = orders.map((o, i) => {
        const items = (o.items ?? []).map((it: any) => it.offer?.name ?? it.productName ?? '').filter(Boolean).join(', ');
        return `${i + 1}. #${o.number} | ${o.status} | ${items || '—'} | ${o.totalSumm ?? 0} ₽`;
    }).join('\n') || 'История заказов отсутствует';

    const manager_comments = orders.filter(o => o.managerComment).slice(0, 5).map(o => `[#${o.number}]: ${o.managerComment}`).join('\n') 
        || (customer.notes ?? '(комментарии отсутствуют)');

    // 5. Генерировать письмо + Обоснование
    const result = await generateReactivationEmail({
        company_name,
        contact_person: contactPersonName,
        orders_history,
        manager_comments,
        custom_prompt: settings.victoria_prompt,
        industry: dbClient?.industry ?? undefined,
        category: dbClient?.category ?? undefined,
        total_summ: dbClient?.total_summ ?? undefined,
        orders_count: dbClient?.orders_count ?? undefined,
        average_check: dbClient?.average_check ?? undefined,
        call_transcripts: call_transcripts || undefined,
    });

    // 6. Сохранить как черновик (awaiting_approval)
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            generated_email: result.body,
            justification: result.reasoning,
            status: 'awaiting_approval'
        })
        .eq('id', log.id);

    if (error) throw error;
}

// ТАКТ 2: Физическая отправка одобренного письма
async function sendApprovedEmail(log: OutreachLog): Promise<void> {
    const customerId = log.customer_id;
    
    // Получаем карточку клиента для определения его сайта и последнего заказа
    const customerRes = await retailcrmFetch(`/api/v5/customers-corporate/${customerId}`);
    const customer = customerRes.customerCorporate ?? {};
    const customerSite = customer.site || process.env.RETAILCRM_SITE || 'zmktlt-ru';
    
    const ordersRes = await retailcrmFetch(`/api/v5/orders?filter[customerCorporate]=${customerId}&limit=1&page=1`);
    const lastOrderNumber = ordersRes.orders?.[0]?.number ?? null;

    // Добавляем пиксель отслеживания (Tracking Pixel)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com';
    const pixelUrl = `${baseUrl.replace(/\/+$/, '')}/api/reactivation/track?id=${log.id}`;
    const emailBodyWithPixel = `${log.generated_email || ''}\n\n<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;

    // Записываем в CRM (триггер в CRM сам отправит письмо)
    await updateCorporateFields(
        customerId, 
        emailBodyWithPixel, 
        customerSite,
        lastOrderNumber
    );

    // Помечаем как отправлено
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            status: 'sent',
            sent_at: new Date().toISOString()
        })
        .eq('id', log.id);

    if (error) throw error;
}

// ─────────────────────────────────────────────────────
// 🛠️ UTILS
// ─────────────────────────────────────────────────────

async function updateCorporateFields(
    customerId: number,
    emailBody: string,
    site: string,
    lastOrderNumber?: string | number | null
): Promise<void> {
    // ВАЖНО: RetailCRM API v5 требует by=id в URL и сериализованный JSON в теле
    const customerData = {
        customFields: {
            ai_reactivation_text: emailBody,
            ai_last_order_number: lastOrderNumber ? String(lastOrderNumber) : undefined
        }
    };

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}&by=id&site=${site}`;
    
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `customerCorporate=${encodeURIComponent(JSON.stringify(customerData))}`,
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`RetailCRM corporate/edit failed: ${res.status} — ${errText.substring(0, 300)}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`RetailCRM API error: ${data.errorMsg || 'Unknown error'}`);
    }
}

async function retailcrmFetch(path: string): Promise<any> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${RETAILCRM_URL}${path}${sep}apiKey=${RETAILCRM_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RetailCRM ${path} → HTTP ${res.status}`);
    return res.json();
}
