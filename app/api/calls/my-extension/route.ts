/**
 * Чей телефон у этого человека и все ли звонки ему показывать.
 *
 * Нужно окну входящего звонка: оно всплывает у хозяина добавочного, а не у всех
 * подряд (решение владельца 05.10.2026). Руководитель и ОКК видят все звонки —
 * иначе у них пропадёт картина по отделу.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** Кому показываем всё: они отвечают за отдел, а не за свой телефон. */
const SEE_ALL_ROLES = new Set(['admin', 'okk', 'rop']);

export async function GET() {
    const session = await enrichSessionWithManagerIdentity(await getSession());
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const managerId = (session.user as any).retail_crm_manager_id;
    let extension: string | null = null;

    if (managerId) {
        const { data } = await supabase
            .from('managers')
            .select('telphin_extension')
            .eq('id', managerId)
            .maybeSingle();
        const value = (data as any)?.telphin_extension;
        extension = value ? String(value).trim() : null;
    }

    return NextResponse.json({
        extension,
        seeAll: SEE_ALL_ROLES.has(String(session.user.role)),
    });
}
