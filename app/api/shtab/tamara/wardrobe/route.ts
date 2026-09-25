import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/utils/supabase';
import { drawConfigured } from '@/lib/shtab/outfit-draw';

export const dynamic = 'force-dynamic';

// Гардероб Тамары: что в нём лежит и по какому заданию сшито.
//
// Правка заданий — владельцу, не разработчику. «Слишком мешковато» и «пусть
// каблук будет ниже» — это строка в промпте, и ходить за ней в код неправильно:
// вкус меняется чаще, чем выкатывается релиз.
//
// Сами картинки отсюда не создаются. Отрисовка идёт через постоянный субъект
// Kling, ключ которого на прод не выведен, и новый образ всё равно принимает
// человек глазами. Поэтому здесь — задания и условия, а шитьё остаётся
// отдельным шагом.

export async function GET() {
    try {
        const { data: rows } = await supabase
            .from('tamara_wardrobe')
            .select('id, slug, title, image_url, prompt, season, weekday, temp_min, temp_max, rain, active')
            .order('id');

        const { data: settings } = await supabase
            .from('shtab_settings')
            .select('key, value')
            .in('key', ['outfit_base_prompt', 'outfit_element_id', 'outfit_enabled']);
        const map = new Map(((settings ?? []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));

        // Отрисовка выключена, пока нет ключей: закон гласит, что незаконченное
        // видно в интерфейсе, а не выясняется по отсутствию новых кадров.
        const { data: today } = await supabase
            .from('tamara_outfit_day')
            .select('draw_error')
            .eq('on_date', new Date().toISOString().slice(0, 10))
            .maybeSingle();

        return NextResponse.json({
            ok: true,
            enabled: (map.get('outfit_enabled') ?? 'true') === 'true',
            basePrompt: map.get('outfit_base_prompt') ?? '',
            elementId: map.get('outfit_element_id') ?? '',
            drawConfigured: drawConfigured(),
            drawError: String((today as any)?.draw_error ?? ''),
            wardrobe: rows ?? [],
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
}

const Body = z.object({
    enabled: z.boolean().optional(),
    basePrompt: z.string().max(4000).optional(),
    looks: z
        .array(
            z.object({
                id: z.number(),
                prompt: z.string().max(4000),
                season: z.enum(['any', 'zima', 'vesna', 'leto', 'osen']),
                weekday: z.enum(['any', 'budni', 'pyatnitsa', 'vyhodnoy']),
                temp_min: z.number().int().nullable(),
                temp_max: z.number().int().nullable(),
                rain: z.boolean().nullable(),
                active: z.boolean(),
            }),
        )
        .max(200)
        .optional(),
});

export async function PUT(req: NextRequest) {
    try {
        const parsed = Body.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'Неверные данные' }, { status: 400 });
        }
        const { enabled, basePrompt, looks } = parsed.data;

        if (basePrompt !== undefined) {
            await supabase
                .from('shtab_settings')
                .upsert({ key: 'outfit_base_prompt', value: basePrompt }, { onConflict: 'key' });
        }
        if (enabled !== undefined) {
            await supabase
                .from('shtab_settings')
                .upsert({ key: 'outfit_enabled', value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
        }

        // По одному: обновляются только присланные поля, а slug, название и
        // картинка остаются как были — их правка означала бы другой образ.
        for (const l of looks ?? []) {
            const { id, ...fields } = l;
            await supabase.from('tamara_wardrobe').update(fields).eq('id', id);
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
}
