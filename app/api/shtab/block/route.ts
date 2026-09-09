import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET  /api/shtab/block?razbor_id= — блоки разбора вместе с программами и задачами.
// POST /api/shtab/block            — сохранить нарезку целиком (утверждает владелец).
// DELETE /api/shtab/block?id=      — убрать блок вместе с его программой.

const BlockSchema = z.object({
    ordinal: z.number().int().min(0).default(0),
    title: z.string().trim().min(1, 'У блока нет названия').max(200),
    excerpt: z.string().max(4000).default(''),
    rationale: z.string().max(4000).default(''),
});

const SaveSchema = z.object({
    razbor_id: z.number().int().positive(),
    blocks: z.array(BlockSchema).max(20),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const razborId = Number(req.nextUrl.searchParams.get('razbor_id'));
        if (!Number.isFinite(razborId)) return NextResponse.json({ error: 'Не передан razbor_id' }, { status: 400 });

        const [blocksRes, kindsRes] = await Promise.all([
            supabase
                .from('shtab_block')
                .select('id, ordinal, title, excerpt, rationale')
                .eq('razbor_id', razborId)
                .order('ordinal'),
            supabase.from('shtab_task_kind').select('code, title, hint, ordinal').order('ordinal'),
        ]);
        if (blocksRes.error) throw new Error(blocksRes.error.message);
        if (kindsRes.error) throw new Error(kindsRes.error.message);

        const blocks = blocksRes.data ?? [];
        const ids = blocks.map((b: any) => b.id);

        let programs: any[] = [];
        let tasks: any[] = [];
        if (ids.length > 0) {
            const { data: p, error: pe } = await supabase
                .from('shtab_program')
                .select('id, block_id, main_task, manager_name, status, source')
                .in('block_id', ids);
            if (pe) throw new Error(pe.message);
            programs = p ?? [];

            if (programs.length > 0) {
                const { data: t, error: te } = await supabase
                    .from('shtab_task')
                    .select('id, program_id, kind, ordinal, text, why, metric, target_value, source_note, fact_value, done, project_id')
                    .in('program_id', programs.map((x) => x.id))
                    .order('ordinal');
                if (te) throw new Error(te.message);
                tasks = t ?? [];
            }
        }

        return NextResponse.json({ blocks, programs, tasks, kinds: kindsRes.data ?? [] });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = SaveSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const { razbor_id, blocks } = parsed.data;

        // Блоки, которых в новой нарезке нет, удаляются вместе со своими
        // программами — на это стоит ON DELETE CASCADE. Поэтому обновляем
        // существующие по названию, а не сносим всё подряд: иначе перенумерация
        // блоков уносила бы написанные под них программы.
        const { data: existing, error: exError } = await supabase
            .from('shtab_block')
            .select('id, title')
            .eq('razbor_id', razbor_id);
        if (exError) throw new Error(exError.message);

        const byTitle = new Map<string, number>((existing ?? []).map((b: any) => [b.title.trim().toLowerCase(), b.id]));
        const kept: number[] = [];

        for (const b of blocks) {
            const key = b.title.trim().toLowerCase();
            const id = byTitle.get(key);
            if (id) {
                const { error } = await supabase
                    .from('shtab_block')
                    .update({ ordinal: b.ordinal, excerpt: b.excerpt, rationale: b.rationale, updated_at: new Date().toISOString() })
                    .eq('id', id);
                if (error) throw new Error(error.message);
                kept.push(id);
            } else {
                const { data, error } = await supabase
                    .from('shtab_block')
                    .insert({ razbor_id, ordinal: b.ordinal, title: b.title, excerpt: b.excerpt, rationale: b.rationale })
                    .select('id')
                    .single();
                if (error) throw new Error(error.message);
                kept.push(data.id);
            }
        }

        const stale = (existing ?? []).filter((b: any) => !kept.includes(b.id)).map((b: any) => b.id);
        if (stale.length > 0) {
            const { error } = await supabase.from('shtab_block').delete().in('id', stale);
            if (error) throw new Error(error.message);
        }

        return NextResponse.json({ ok: true, saved: kept.length, removed: stale.length });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(req.nextUrl.searchParams.get('id'));
        if (!Number.isFinite(id)) return NextResponse.json({ error: 'Не передан id' }, { status: 400 });

        const { error } = await supabase.from('shtab_block').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
