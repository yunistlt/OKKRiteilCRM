/**
 * Регулярная синхронизация контактных лиц клиентов.
 *
 * Без неё таблица контактов устаревает молча — ровно так до 30.09.2026 отставали
 * позиции заказов. Берём изменённые за последние сутки, с запасом.
 */
import { NextResponse } from 'next/server';
import { isRetailcrmInboundSyncEnabled, RETAILCRM_READ_BLOCKED_MESSAGE } from '@/lib/retailcrm/inbound-guard';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { syncCustomers } from '@/lib/retailcrm/customers-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
    // Рубильник чтения из RetailCRM: мы живём в ОКК, снимок чужой системы не
    // должен перезаписывать нашу работу (решение владельца 09.10.2026).
    if (!(await isRetailcrmInboundSyncEnabled())) {
        return NextResponse.json({ ok: false, skipped: true, reason: RETAILCRM_READ_BLOCKED_MESSAGE }, { status: 200 });
    }

    if (!isCronHeaderAuthorized(request)) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
        const result = await syncCustomers(since);
        return NextResponse.json({ ok: true, ...result });
    } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
    }
}
