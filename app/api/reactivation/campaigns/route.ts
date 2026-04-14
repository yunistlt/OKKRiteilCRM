/**
 * GET  /api/reactivation/campaigns  — список кампаний
 * POST /api/reactivation/campaigns  — создать кампанию + заполнить очередь из RetailCRM
 *
 * Все фильтры и настройки агентов приходят из тела запроса (заполняются в UI).
 * Никаких захардкоженных значений фильтров нет.
 */

// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { 
    getCampaigns, 
    createCampaign, 
    createOutreachLog, 
    CampaignFilters, 
    CampaignSettings 
} from '@/lib/reactivation-db';

// ──────────────────────────────────────────
// GET — список кампаний
// ──────────────────────────────────────────
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

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
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

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

        // 2. Найти клиентов в SUPABASE по фильтрам (теперь это источник истины)
        const customers = await fetchEligibleCustomers(filters ?? {});

        // 3. Создать записи очереди
        let queued = 0;
        for (const customer of customers) {
            try {
                await createOutreachLog({
                    campaign_id: campaign.id,
                    customer_id: customer.id,
                    company_name: customer.company_name || `Клиент #${customer.id}`,
                    customer_email: customer.email || undefined,
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
// Fetch customers from SUPABASE with all filters
// ──────────────────────────────────────────

interface EligibleCustomer {
    id: number;
    email?: string;
    company_name?: string;
}

async function fetchEligibleCustomers(filters: CampaignFilters): Promise<EligibleCustomer[]> {
    let query = supabase
        .from('clients')
        .select('id, email, company_name')
        .not('email', 'is', null);

    // B2B Only
    if (filters.b2b_only) {
        query = query.in('contragent_type', ['Юридическое лицо', 'Индивидуальный предприниматель']);
    }

    // Давность последнего заказа
    if (filters.months) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - filters.months);
        query = query.lt('last_order_at', cutoff.toISOString());
    }

    // LTV
    if (filters.min_ltv !== undefined && filters.min_ltv > 0) {
        query = query.gte('total_summ', filters.min_ltv);
    }

    // Кол-во заказов
    if (filters.min_orders !== undefined) {
        query = query.gte('orders_count', filters.min_orders);
    }
    if (filters.max_orders !== undefined && filters.max_orders < 999999) {
        query = query.lte('orders_count', filters.max_orders);
    }

    // Средний чек
    if (filters.min_avg_check !== undefined && filters.min_avg_check > 0) {
        query = query.gte('average_check', filters.min_avg_check);
    }
    if (filters.max_avg_check !== undefined && filters.max_avg_check < 999999) {
        query = query.lte('average_check', filters.max_avg_check);
    }

    // Ограничение выборки для безопасности
    query = query.limit(500);

    const { data, error } = await query;

    if (error) {
        console.error('[Reactivation] Supabase fetch failed:', error.message);
        return [];
    }

    return (data || []).map(d => ({
        id: d.id,
        email: d.email,
        company_name: d.company_name
    }));
}
