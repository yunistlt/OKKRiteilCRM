import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH  /api/shtab/tamara/chats/[id] — переименовать или убрать в архив.
// DELETE /api/shtab/tamara/chats/[id] — удалить разговор вместе с репликами.
//
// Архив, а не удаление, — обычный путь: переписка с наставницей это рабочий
// документ, и терять её из-за прибранного списка не надо.

const PatchSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = PatchSchema.safeParse(await req.json());
        if (!parsed.success || Object.keys(parsed.data).length === 0) {
            return NextResponse.json({ error: 'Нечего менять' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('shtab_tamara_chat')
            .update({ ...parsed.data, updated_at: new Date().toISOString() })
            .eq('id', Number(params.id))
            .select('id, title, summary, summary_upto_id, archived, created_at, updated_at')
            .single();
        if (error) throw new Error(error.message);
        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const { error } = await supabase.from('shtab_tamara_chat').delete().eq('id', Number(params.id));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
