import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { isRetailcrmConfigured, syncRetailcrmCatalog } from '@/lib/retailcrm-dictionaries-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/sync/dictionaries — ПОЛНЫЙ синк каталога RetailCRM:
// все справочники (custom-dictionaries со значениями) + все поля (custom-fields
// по order/customer/customer_corporate), активные и неактивные.
// Доступ: cron (Authorization: Bearer CRON_SECRET) ИЛИ админ из браузера.
export async function GET(req: Request) {
    const authHeader = req.headers.get('authorization');
    const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
    if (!isCron) {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
    }
    if (!isRetailcrmConfigured()) {
        return NextResponse.json({ error: 'RetailCRM config missing (RETAILCRM_URL/RETAILCRM_API_KEY)' }, { status: 500 });
    }
    try {
        const result = await syncRetailcrmCatalog();
        console.log('[Dict Sync] Готово:', result);
        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('[Dict Sync] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
