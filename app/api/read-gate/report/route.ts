import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/read-gate/report?date=YYYY-MM-DD — кто прочитал разбор.
 *
 * Время чтения — не показатель качества и в баллы менеджера не идёт. Это
 * повод для разговора: видно, кто подтверждает ровно на пороге несколько дней
 * подряд и кто третий день подряд откладывает.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const from = `${date}T00:00:00+03:00`;
    const to = `${date}T23:59:59+03:00`;

    const { data: rows } = await supabase
        .from('document_read_gate')
        .select('*')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false });

    const gates = (rows ?? []) as any[];
    const userIds = Array.from(new Set(gates.map((g) => g.user_id)));
    const names = new Map<string, string>();
    if (userIds.length) {
        const { data: users } = await supabase
            .from('users')
            .select('id, username, first_name, last_name')
            .in('id', userIds);
        for (const u of ((users ?? []) as any[])) {
            names.set(u.id, [u.last_name, u.first_name].filter(Boolean).join(' ') || u.username);
        }
    }

    // Три дня подряд — срок, на котором формальное чтение перестаёт быть
    // случайностью. Считаем по тем же данным, отдельного журнала не заводим.
    const since = new Date(Date.parse(from) - 3 * 24 * 3600_000).toISOString();
    const { data: history } = await supabase
        .from('document_read_gate')
        .select('user_id, visible_seconds, required_seconds, confirmed_at, deferred_at, created_at')
        .gte('created_at', since);

    const hist = (history ?? []) as any[];
    const formalDays = new Map<string, number>();
    const deferDays = new Map<string, number>();
    for (const h of hist) {
        const day = String(h.created_at).slice(0, 10);
        if (h.confirmed_at && h.visible_seconds <= h.required_seconds + 2) {
            formalDays.set(`${h.user_id}|${day}`, 1);
        }
        if (h.deferred_at) deferDays.set(`${h.user_id}|${day}`, 1);
    }
    const countDays = (map: Map<string, number>, userId: string) =>
        Array.from(map.keys()).filter((k) => k.startsWith(`${userId}|`)).length;

    return NextResponse.json({
        date,
        rows: gates.map((g) => {
            const readSeconds = g.visible_seconds;
            return {
                userId: g.user_id,
                name: names.get(g.user_id) ?? g.user_id,
                docKind: g.doc_kind,
                openedAt: g.opened_at,
                confirmedAt: g.confirmed_at,
                readSeconds,
                requiredSeconds: g.required_seconds,
                scrolledToEnd: g.scrolled_to_end,
                deferredAt: g.deferred_at,
                deferReason: g.defer_reason,
                // Подтверждение ровно на пороге — читают формально.
                formal: !!g.confirmed_at && readSeconds <= g.required_seconds + 2,
                formalDays: countDays(formalDays, g.user_id),
                deferDays: countDays(deferDays, g.user_id),
            };
        }),
    });
}
