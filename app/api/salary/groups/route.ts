import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { listRetailcrmGroups } from '@/lib/salary/roles';

export const dynamic = 'force-dynamic';

// GET /api/salary/groups — справочник групп пользователей RetailCRM (роли)
// для выбора при создании схемы. Источник — retailcrm_dictionaries (userGroup).
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const groups = await listRetailcrmGroups();
        return NextResponse.json({ groups });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
