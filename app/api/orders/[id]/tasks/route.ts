import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
    title: z.string().min(1).max(300),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** Время срока: «перезвонить в 14:30». Пусто — срок на весь день. */
    dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

/**
 * Правка задачи. `done` — галочка «выполнено», остальное — сама задача.
 *
 * Просьба Елены Парфёновой 08.10.2026: «забыла поставить время, а
 * редактировать не даёт, только удалять и создавать новую». Поэтому текст,
 * дату и время меняем на месте.
 */
const UpdateSchema = z.object({
    id: z.string().uuid(),
    done: z.boolean().optional(),
    title: z.string().min(1).max(300).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

/** Задачи по заказу. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;

    const { data, error } = await supabase
        .from('order_tasks')
        .select('*')
        .eq('order_number', String(id))
        .order('done')
        .order('due_date', { nullsFirst: false })
        .order('due_time', { nullsFirst: false })
        .order('created_at');

    if (error) {
        console.error('[order-tasks] Не удалось прочитать задачи:', error);
        return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }

    const tasks = data || [];
    return NextResponse.json({
        ok: true,
        tasks,
        done: tasks.filter((t: any) => t.done).length,
        total: tasks.length,
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;

    let body: z.infer<typeof CreateSchema>;
    try {
        body = CreateSchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const author = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ')
        || session.user.email
        || session.user.role;

    const { data, error } = await supabase
        .from('order_tasks')
        .insert({
            order_number: String(id),
            title: body.title,
            due_date: body.dueDate || null,
            due_time: body.dueTime || null,
            created_by: author,
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: 'insert_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, task: data });
}

/** Отметить выполненной или вернуть в работу. */
export async function PATCH(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let body: z.infer<typeof UpdateSchema>;
    try {
        body = UpdateSchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.done !== undefined) {
        patch.done = body.done;
        patch.done_at = body.done ? new Date().toISOString() : null;
    }
    if (body.title !== undefined) patch.title = body.title;
    // Срок снимается целиком: дата пустая — время тоже, иначе остаётся «в 14:30»
    // без дня.
    if (body.dueDate !== undefined) {
        patch.due_date = body.dueDate;
        if (!body.dueDate) patch.due_time = null;
    }
    if (body.dueTime !== undefined && body.dueDate !== null) patch.due_time = body.dueTime;

    if (!Object.keys(patch).length) {
        return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('order_tasks')
        .update(patch)
        .eq('id', body.id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: 'update_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, task: data });
}
