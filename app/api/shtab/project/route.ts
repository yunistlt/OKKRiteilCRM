import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// POST /api/shtab/project — завести проект под разбор.
// Ответственный и срок необязательны на входе: их заводят черновиком и заполняют
// следом. На пустоту ругается интерфейс (lib/shtab/checks.ts), а не схема —
// иначе проект нельзя было бы записать, пока не придуман исполнитель.

const PROJECT_COLUMNS = 'id, razbor_id, ordinal, title, owner_name, due_on, status, note';

const CreateSchema = z.object({
    razbor_id: z.number().int().positive(),
    title: z.string().trim().min(1, 'Название проекта пустое').max(300),
    owner_name: z.string().trim().max(200).default(''),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Срок должен быть датой').nullable().optional(),
    note: z.string().max(2000).default(''),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = CreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const { razbor_id, ...fields } = parsed.data;

        const { count, error: countError } = await supabase
            .from('shtab_project')
            .select('id', { count: 'exact', head: true })
            .eq('razbor_id', razbor_id);
        if (countError) throw new Error(countError.message);

        const { data, error } = await supabase
            .from('shtab_project')
            .insert({ razbor_id, ordinal: count ?? 0, ...fields, due_on: fields.due_on ?? null })
            .select(PROJECT_COLUMNS)
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json(data, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
