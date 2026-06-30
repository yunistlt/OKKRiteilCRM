/**
 * Настройки расходов на ИИ: курс USD→RUB и тарифы моделей.
 * GET  — текущий курс + тарифы.
 * POST — сохранить курс и/или тарифы.
 * Доступ: admin (RBAC '/api/settings').
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
    usd_to_rub: z.number().positive().optional(),
    pricing: z
        .array(
            z.object({
                model: z.string().min(1),
                input_per_1m: z.number().min(0),
                cached_input_per_1m: z.number().min(0),
                output_per_1m: z.number().min(0),
            })
        )
        .optional(),
});

export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [{ data: cfg }, { data: pricing }] = await Promise.all([
        supabase.from('ai_cost_settings').select('usd_to_rub').maybeSingle(),
        supabase.from('ai_model_pricing').select('model, input_per_1m, cached_input_per_1m, output_per_1m, note').order('model'),
    ]);
    return NextResponse.json({ usd_to_rub: Number(cfg?.usd_to_rub) || 90, pricing: pricing || [] });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    let parsed;
    try {
        parsed = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: e?.errors?.[0]?.message || 'Неверные данные' }, { status: 400 });
    }

    if (typeof parsed.usd_to_rub === 'number') {
        const { error } = await supabase
            .from('ai_cost_settings')
            .update({ usd_to_rub: parsed.usd_to_rub, updated_at: new Date().toISOString() })
            .eq('id', true);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const p of parsed.pricing || []) {
        const { error } = await supabase.from('ai_model_pricing').upsert(
            {
                model: p.model,
                input_per_1m: p.input_per_1m,
                cached_input_per_1m: p.cached_input_per_1m,
                output_per_1m: p.output_per_1m,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'model' }
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
