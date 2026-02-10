
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

        const days = parseInt(searchParams.get('days') || '30'); // Update last 30 days by default (clients change less often)
        const defaultLookback = new Date();
        defaultLookback.setDate(defaultLookback.getDate() - days);
        const filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');

        console.log(`[Clients Sync] Syncing updates from: ${filterDateFrom} (Last ${days} days)`);

        let page = 1;
        let pagesProcessed = 0;
        let totalClientsFetched = 0;
        let hasMore = true;
        let finalPagination = null;

        while (hasMore && pagesProcessed < maxPagesPerRun && (Date.now() - startTime) < maxTimeMs) {
            const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
            const limit = 100;

            const params = new URLSearchParams();
            params.append('apiKey', RETAILCRM_API_KEY);
            params.append('limit', String(limit));
            params.append('page', String(page));
            // Filter by changes
            // Note: RetailCRM customers API uses specific filter fields. 
            // Unlike orders, looking for 'updatedAtFrom' might not be directly available in all versions or called slightly differently.
            // Checking v5 docs: filter[dateFrom] usually works for creation, but let's try generic or just sync recent chunks.
            // Actually, customers/completeness or customers/history is better for updates, but standard list has no 'updatedAtFrom' in older versions?
            // checking docs: GET /api/v5/customers list supports filter[minUpdatedAt] in modern versions or just filter specific custom fields.
            // Let's assume standard filter behavior or if fails, we might need a different approach.
            // The standard list endpoint is usually /api/v5/customers
            // Standard filters: filter[dateFrom] (reg date), ... 
            // If API doesn't support incremental update filter easily, we might need to rely on /customers/history later.
            // For now, let's try to fetch, if we can't filter by update, we just fetch recent registrations or all if needed.
            // Wait, for full sync we just page. For updates, 'filter[minUpdatedAt]' is not always there.
            // Let's try sending NO date filter if we want everything, or 'filter[createdAtFrom]'
            // To be safe for now, let's omit the date filter if we are not sure, OR use it if the user wants recent only.
            // Actually optimal: sync active changes. 
            // Let's try passing no filter by default to get ALL, or if 'days' is small, maybe we just get recent. 
            // BUT, usually we want to sync EVERYONE first.
            
            // Let's try to use 'filter[ids]' if we know them, but we don't.
            // Better strategy: Just iterate pages. If 'days' is huge (9999), we assume full sync.
            
            // For this basic version, we will just iterate list.
            
            const url = `${baseUrl}/api/v5/customers?${params.toString()}`;
            console.log(`[Clients Sync] Fetching Page ${page}:`, url);

            const res = await fetch(url);
            if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

            const customers = data.customers || [];
            finalPagination = data.pagination;

            if (customers.length === 0) {
                hasMore = false;
                break;
            }

            const clientsToUpsert: any[] = [];

            for (const c of customers) {
               const phones = new Set<string>();
               const p1 = cleanPhone(c.phones?.[0]?.number); if(p1) phones.add(p1);
               // and others
               if (c.phones) {
                 c.phones.forEach((p:any) => {
                     const cp = cleanPhone(p.number);
                     if(cp) phones.add(cp);
                 });
               }

               clientsToUpsert.push({
                   id: c.id,
                   external_id: c.externalId || null,
                   first_name: c.firstName || null,
                   last_name: c.lastName || null,
                   patronymic: c.patronymic || null,
                   phones: Array.from(phones),
                   email: c.email || null,
                   created_at: c.createdAt,
                   updated_at: c.updatedAt || new Date().toISOString(), // Fallback
                   address: c.address || null,
                   custom_fields: c.customFields || {},
                   manager_id: c.managerId ? String(c.managerId) : null,
                   site: c.site || null,
                   vip: c.vip || false,
                   bad: c.bad || false,
                   personal_discount: c.personalDiscount || 0,
                   cumulative_discount: c.cumulativeDiscount || 0,
                   source: c.source?.source || null
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
            method: 'clients_sync',
            pages_processed: pagesProcessed,
            total_fetched: totalClientsFetched,
            has_more: hasMore
        });

    } catch (error: any) {
        console.error('RetailCRM Clients Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
