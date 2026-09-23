import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { loadStructure } from '@/lib/shtab/structure';

export const dynamic = 'force-dynamic';

// GET /api/shtab/structure — посты схемы и их документы.
// PUT /api/shtab/structure — записать раскладку холста пачкой.

const LayoutSchema = z.object({
    layout: z
        .array(
            z.object({
                id: z.number().int().positive(),
                x: z.number().int().min(-20000).max(20000),
                y: z.number().int().min(-20000).max(20000),
            }),
        )
        .min(1)
        .max(500),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        return NextResponse.json(await loadStructure());
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = LayoutSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }

        // Одной функцией, а не пачкой запросов: обрыв посередине оставил бы
        // часть блоков на новых местах, часть на старых.
        const { data, error } = await supabase.rpc('shtab_post_layout_set', { p_layout: parsed.data.layout });
        if (error) throw new Error(error.message);
        return NextResponse.json({ moved: data ?? 0 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
