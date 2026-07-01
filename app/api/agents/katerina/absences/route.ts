/**
 * Отпуска/отсутствия менеджеров (Катерина). В период отсутствия менеджер выпадает из
 * распределения НОВЫХ клиентов; постоянные клиенты по истории — по-прежнему к нему.
 * GET — список отпусков + менеджеры пула (для формы). POST — добавить. DELETE — убрать по id.
 * Доступ: admin/rop (RBAC '/api/agents/katerina').
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { getManagerPool, getManagerNames, getAbsences } from '@/lib/email/assign';

export const dynamic = 'force-dynamic';

const AddSchema = z.object({
    manager_id: z.number().int().positive(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
    note: z.string().max(200).optional(),
});

export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const pool = await getManagerPool();
    const [names, absences] = await Promise.all([getManagerNames(pool), getAbsences()]);
    const managers = pool.map((id) => ({ id, name: names[id] || String(id) }));
    return NextResponse.json({ managers, absences });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    let body;
    try {
        body = AddSchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: e?.errors?.[0]?.message || 'Неверные данные' }, { status: 400 });
    }
    if (body.end_date < body.start_date) {
        return NextResponse.json({ error: 'Дата окончания раньше даты начала' }, { status: 400 });
    }
    const { error } = await supabase.from('email_intake_absences').insert({
        manager_id: body.manager_id,
        start_date: body.start_date,
        end_date: body.end_date,
        note: body.note || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: 'Неверный id' }, { status: 400 });
    }
    const { error } = await supabase.from('email_intake_absences').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
