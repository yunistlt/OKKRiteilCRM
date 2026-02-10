
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Helper to normalize phone numbers
function cleanPhone(val: any): string {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

export async function GET(request: Request) {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const startTime = Date.now();
        const maxTimeMs = 50000; // 50 seconds limit
        const maxPagesPerRun = 20; // Safe limit

        // Incremental Sync Logic
        // 1. Check last sync time (max created_at in DB)
        const ignoreDb = searchParams.get('ignore_db') === 'true';
        let lastClient = null;

        if (!ignoreDb) {
            const { data } = await supabase
                .from('clients')
                .select('created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            lastClient = data;
        }

        let filterDateFrom: string;
        let days = parseInt(searchParams.get('days') || '30');

        if (lastClient && lastClient.created_at) {
            // Add 1 second buffer to avoid re-fetching the exact same last record too often (though API usually handles >=)
            // Actually RetailCRM filter is usually inclusive, so we might get the last one again, which upsert handles.
            const lastDate = new Date(lastClient.created_at);
            filterDateFrom = lastClient.created_at; // ISO string
            console.log(`[Corporate Clients Sync] Found existing clients. Resuming from: ${filterDateFrom}`);
        } else {
            // First run or empty table or forced full sync
            const defaultLookback = new Date();
            defaultLookback.setDate(defaultLookback.getDate() - days);
            filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');
            console.log(`[Corporate Clients Sync] Starting fresh/full sync from: ${filterDateFrom} (Last ${days} days)`);
        }

        // 2. Add filter to params
        const params = new URLSearchParams();
        params.append('apiKey', RETAILCRM_API_KEY);
        // params.append('filter[createdAtFrom]', filterDateFrom); 
        // Note: For corporate customers, check API docs for correct filter param.
        // v5 docs: /api/v5/customers-corporate
        // filters: filter[createdAtFrom], filter[dateFrom]... usually [createdAtFrom]
        params.append('filter[createdAtFrom]', filterDateFrom);

        let page = parseInt(searchParams.get('start_page') || '1');
        let pagesProcessed = 0;
        let totalClientsFetched = 0;
        let hasMore = true;
        let finalPagination = null;

        while (hasMore && pagesProcessed < maxPagesPerRun && (Date.now() - startTime) < maxTimeMs) {
            const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
            const limit = 100;

            // Update params for loop
            params.set('limit', String(limit));
            params.set('page', String(page));

            // Fetch Corporate Customers
            // Endpoint: /api/v5/customers-corporate
            const url = `${baseUrl}/api/v5/customers-corporate?${params.toString()}`;
            console.log(`[Corporate Clients Sync] Fetching Page ${page}:`, url);

            const res = await fetch(url);
            if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

            const customers = data.customersCorporate || [];
            finalPagination = data.pagination;

            if (customers.length === 0) {
                hasMore = false;
                break;
            }

            const clientsToUpsert: any[] = [];

            for (const c of customers) {
                const phones = new Set<string>();

                // Corporate Data Mapping
                // Name -> nickName (The company name)
                // Address -> typically in proper addresses array, but we take first or main
                // Phones -> can be in main object or contact persons (usually contact persons)

                // 1. Extract phones from company (if any directly)
                if (c.phones) {
                    c.phones.forEach((p: any) => {
                        const cp = cleanPhone(p.number);
                        if (cp) phones.add(cp);
                    });
                }

                // 2. Extract phones from contact persons (Main contact)
                // Assuming logic: aggregate all phones or just main? Let's aggregate.
                // Also picking main contact name logic if needed, but we save company name separately.

                // RetailCRM Structure for corporate:
                // c.nickName = "ООО Ромашка"
                // c.contactPersons = []

                // Let's try to find main contact person name if first_name/last_name logic required
                let mainFirstName = null;
                let mainLastName = null;
                let mainPatronymic = null;

                // But schema has company_name now.

                clientsToUpsert.push({
                    id: c.id,
                    external_id: c.externalId || null,
                    first_name: mainFirstName, // Leave empty or map main contact? Let's keep empty for now, relying on company_name
                    last_name: null,
                    patronymic: null,
                    phones: Array.from(phones),
                    email: c.email || null, // Company email
                    created_at: c.createdAt,
                    updated_at: c.updatedAt || new Date().toISOString(),
                    address: c.mainAddress || (c.addresses ? c.addresses[0] : null), // Try mainAddress or first
                    custom_fields: c.customFields || {},
                    manager_id: c.managerId ? String(c.managerId) : null,
                    site: c.site || null,
                    vip: c.vip || false,
                    bad: c.bad || false,
                    personal_discount: c.personalDiscount || 0,
                    cumulative_discount: c.cumulativeDiscount || 0,
                    source: c.source?.source || null,

                    // New Corporate Fields
                    company_name: c.nickName || null,
                    inn: c.contragent?.inn || null, // Check path
                    kpp: c.contragent?.kpp || null,
                    contragent_type: c.contragent?.contragentType || null
                });
            }

            if (clientsToUpsert.length > 0) {
                const { error } = await supabase.rpc('upsert_clients', {
                    clients_data: clientsToUpsert
                });

                if (error) {
                    console.error('RPC Upsert Clients Error:', error);
                    throw error;
                }
            }

            totalClientsFetched += customers.length;
            pagesProcessed++;

            if (finalPagination && finalPagination.currentPage < finalPagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }
        }

        return NextResponse.json({
            success: true,
            method: 'corporate_clients_sync',
            pages_processed: pagesProcessed,
            total_fetched: totalClientsFetched,
            has_more: hasMore,
            next_page: hasMore ? page : null
        });

    } catch (error: any) {
        console.error('RetailCRM Corporate Clients Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
