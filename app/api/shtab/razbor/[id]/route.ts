import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// PATCH /api/shtab/razbor/[id] — сохранить разбор. Страница шлёт сюда всё, что
// владелец изменил, с задержкой после набора.
//
// Карта ресурсов приходит целиком и перезаписывается: колонки переставляются и
// удаляются, диффать их построчно дороже и ошибочнее, чем положить набор заново.

const ResourceSchema = z.object({
    missing: z.string().trim().max(300).default(''),
    available: z.array(z.string().trim().max(300)).max(20).default([]),
});

const PatchSchema = z
    .object({
        status: z.enum(['draft', 'done']).optional(),
        minus_id: z.number().int().positive().nullable().optional(),
        situation: z.string().max(4000).optional(),
        why: z.string().max(4000).optional(),
        check_inside: z.boolean().nullable().optional(),
        check_res: z.boolean().nullable().optional(),
        check_relief: z.boolean().nullable().optional(),
        goal_fix: z.string().max(2000).optional(),
        goal_grow: z.string().max(2000).optional(),
        strategy: z.string().max(20000).optional(),
        resources: z.array(ResourceSchema).max(30).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Нечего менять' });

const RAZBOR_COLUMNS =
    'id, area_code, status, minus_id, situation, why, check_inside, check_res, check_relief, goal_fix, goal_grow, strategy, created_at';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const parsed = PatchSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const { resources, ...fields } = parsed.data;

        let razbor = null;
        if (Object.keys(fields).length > 0) {
            const { data, error } = await supabase
                .from('shtab_razbor')
                .update({ ...fields, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select(RAZBOR_COLUMNS)
                .maybeSingle();
            if (error) throw new Error(error.message);
            razbor = data;
        } else {
            const { data, error } = await supabase.from('shtab_razbor').select(RAZBOR_COLUMNS).eq('id', id).maybeSingle();
            if (error) throw new Error(error.message);
            razbor = data;
        }
        if (!razbor) return NextResponse.json({ error: 'Разбор не найден' }, { status: 404 });

        if (resources) {
            // Через функцию БД, а не «удалить + вставить» двумя запросами: сбой
            // между ними стёр бы карту ресурсов, которую владелец собирал руками.
            const { error: rpcError } = await supabase.rpc('shtab_set_resources', {
                p_razbor_id: id,
                p_rows: resources,
            });
            if (rpcError) throw new Error(rpcError.message);
        }

        const { data: saved, error: resError } = await supabase
            .from('shtab_resource')
            .select('ordinal, missing, available')
            .eq('razbor_id', id)
            .order('ordinal');
        if (resError) throw new Error(resError.message);

        return NextResponse.json({
            ...razbor,
            resources: (saved ?? []).map((r: { ordinal: number; missing: string; available: string[] | null }) => ({
                ...r,
                available: r.available ?? [],
            })),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
