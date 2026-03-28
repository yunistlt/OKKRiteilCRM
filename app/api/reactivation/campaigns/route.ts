/**
 * GET  /api/reactivation/campaigns  — список кампаний
 * POST /api/reactivation/campaigns  — создать кампанию + заполнить очередь из RetailCRM
 *
 * Все фильтры и настройки агентов приходят из тела запроса (заполняются в UI).
 * Никаких захардкоженных значений фильтров нет.
 */

import { NextResponse } from 'next/server';
import { getCampaigns, createCampaign, createOutreachLog, CampaignFilters, CampaignSettings } from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

// ──────────────────────────────────────────
// GET — список кампаний
// ──────────────────────────────────────────
export async function GET() {
    try {
        const campaigns = await getCampaigns();
        return NextResponse.json({ success: true, campaigns });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// ──────────────────────────────────────────
// POST — создать кампанию + заполнить очередь
// ──────────────────────────────────────────
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { title, filters, settings } = body as {
            title: string;
            filters: CampaignFilters;
            settings: CampaignSettings;
        };

        if (!title) {
            return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
        }

        // 1. Создать кампанию
        const campaign = await createCampaign(title, filters ?? {}, settings ?? {});

        // 2. Найти клиентов в RetailCRM по фильтрам
        const customers = await fetchEligibleCustomers(filters ?? {});

        // 3. Создать записи очереди
        let queued = 0;
        for (const customer of customers) {
            try {
                const mainContact = customer.mainCustomerContact || (customer.contactPersons && customer.contactPersons[0]);
                const email = customer.email || mainContact?.email || null;
                const contactName = mainContact ? `${mainContact.firstName ?? ''} ${mainContact.lastName ?? ''}`.trim() : null;
                
                await createOutreachLog({
                    campaign_id: campaign.id,
                    customer_id: customer.id,
                    company_name: customer.nickName || customer.legalName || contactName || `Клиент #${customer.id}`,
                    customer_email: email ?? undefined,
                });
                queued++;
            } catch (e) {
                console.error(`[Reactivation] Failed to queue customer ${customer.id}:`, e);
            }
        }

        return NextResponse.json(
            { success: true, campaign, queued_customers: queued },
            { status: 201 }
        );
    } catch (e: any) {
        console.error('[Reactivation] POST /campaigns error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// ──────────────────────────────────────────
// Fetch customers from RetailCRM with all filters
// ──────────────────────────────────────────

interface RetailCRMCustomer {
    id: number;
    email?: string;
    nickName?: string;
    legalName?: string;
    totalSumm?: number;
    ordersCount?: number;
    averageSumm?: number;
    customFields?: Record<string, string>;
    contactPersons?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phones?: { number: string }[];
    }[];
    mainCustomerContact?: {
        firstName?: string;
        lastName?: string;
        email?: string;
    };
}

async function fetchEligibleCustomers(filters: CampaignFilters): Promise<RetailCRMCustomer[]> {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) return [];

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('limit', '100');

    // Давность последнего заказа
    if (filters.months) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - filters.months);
        params.set('filter[maxOrderDate]', cutoff.toISOString().slice(0, 10));
    }

    // Статусы заказов
    if (filters.statuses?.length) {
        filters.statuses.forEach((s, i) => params.set(`filter[orderStatuses][${i}]`, s));
    }

    // Endpoint: /api/v5/customers-corporate
    const url = `${RETAILCRM_URL}/api/v5/customers-corporate?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
        console.error('[Reactivation] RetailCRM corporate customers fetch failed:', res.status);
        return [];
    }

    const data = await res.json();
    if (!data.success) return [];

    let customers: RetailCRMCustomer[] = data.customersCorporate ?? [];

    // Фильтры на стороне клиента
    customers = customers.filter(c => {
        // Обязательно наличие контакта (email компании или главного контакта)
        const mainContact = c.mainCustomerContact || (c.contactPersons && c.contactPersons[0]);
        const hasEmail = !!(c.email || mainContact?.email);
        if (!hasEmail) return false;

        // LTV
        if (filters.min_ltv !== undefined && (c.totalSumm ?? 0) < filters.min_ltv) return false;

        // Кол-во заказов
        if (filters.min_orders !== undefined && (c.ordersCount ?? 0) < filters.min_orders) return false;
        if (filters.max_orders !== undefined && (c.ordersCount ?? 0) > filters.max_orders) return false;

        // Средний чек
        if (filters.min_avg_check !== undefined && (c.averageSumm ?? 0) < filters.min_avg_check) return false;
        if (filters.max_avg_check !== undefined && (c.averageSumm ?? 0) > filters.max_avg_check) return false;

        // Пользовательские поля
        if (filters.custom_fields?.length) {
            for (const cf of filters.custom_fields) {
                const val = c.customFields?.[cf.field];
                if (!val || !val.toLowerCase().includes(cf.value.toLowerCase())) return false;
            }
        }

        return true;
    });

    return customers;
}
