/**
 * Синхронизация статусов из RetailCRM — ВЫКЛЮЧЕНА.
 *
 * Статусы ведём у себя: справочник один на весь проект — `crm_statuses`,
 * правится на экране «Статусы и переходы». Этот маршрут наполнял вторую
 * таблицу (`statuses`) теми же статусами, и из-за двух источников экраны
 * показывали код вместо названия (25.10.2026). Таблица `statuses`
 * переименована и помечена на удаление.
 *
 * Маршрут оставлен, чтобы человек, нажавший «синхронизировать статусы»,
 * увидел понятный ответ, а не пустую страницу.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
        ok: false,
        выключено: true,
        сообщение: 'Статусы больше не тянутся из RetailCRM: справочник один — «Статусы и переходы» в настройках. Правьте статусы там.',
    }, { status: 410 });
}
