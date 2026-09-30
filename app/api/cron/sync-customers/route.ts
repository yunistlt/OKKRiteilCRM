/**
 * Регулярная синхронизация контактных лиц клиентов.
 *
 * Без неё таблица контактов устаревает молча — ровно так до 30.09.2026 отставали
 * позиции заказов. Берём изменённые за последние сутки, с запасом.
 */
import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { syncCustomers } from '@/lib/retailcrm/customers-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
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
