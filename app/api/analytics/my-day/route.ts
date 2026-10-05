/**
 * Рабочий день менеджера для экрана «Мой день».
 *
 * Данные всегда свои: очередь, план и показатели того, кто в системе.
 * Руководителю своих продаж нет — он смотрит отдел в своих разделах.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadMyDay } from '@/lib/analytics/my-day';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const managerId = Number(session.user.retail_crm_manager_id ?? 0) || null;

    try {
        const day = await loadMyDay(managerId);
        return NextResponse.json(day);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
