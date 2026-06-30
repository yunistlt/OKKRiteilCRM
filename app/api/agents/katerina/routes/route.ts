/**
 * Настройки агента-секретаря «Катерина»: адреса отделов для пересылки и режимы работы.
 * GET  — текущие маршруты + режимы.
 * POST — сохранить адреса/активность отделов и флаги create_orders / forward_enabled.
 * Доступ: admin/rop (см. RBAC '/api/agents/katerina').
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const DEPARTMENTS = ['accounting', 'logistics', 'legal', 'procurement'] as const;

const BodySchema = z.object({
    routes: z
        .array(
            z.object({
                department: z.enum(DEPARTMENTS),
                email: z.string().trim().email('Некорректный email').or(z.literal('')).nullable(),
                is_active: z.boolean().optional(),
            })
        )
        .optional(),
    create_orders: z.boolean().optional(),
    forward_enabled: z.boolean().optional(),
    // Список исключений на создание заказов: адреса или домены (по одному в элементе).
    order_blocklist: z.array(z.string()).optional(),
});

/** Нормализует список исключений: trim, lowercase, без «mailto:»/«@»-префикса домена, без пустых и дублей. */
function normalizeBlocklist(list: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
        const e = String(raw).trim().toLowerCase().replace(/^mailto:/, '');
        if (!e || !e.includes('.') || /\s/.test(e)) continue; // отбрасываем мусор: нужен домен с точкой, без пробелов
        if (seen.has(e)) continue;
        seen.add(e);
        out.push(e);
    }
    return out;
}

export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [{ data: routes }, { data: cfg }] = await Promise.all([
        supabase.from('email_intake_routes').select('department, label, email, is_active'),
        supabase.from('email_intake_config').select('create_orders, forward_enabled, order_blocklist').maybeSingle(),
    ]);
    return NextResponse.json({
        routes: routes || [],
        create_orders: Boolean(cfg?.create_orders),
        forward_enabled: Boolean(cfg?.forward_enabled),
        order_blocklist: Array.isArray(cfg?.order_blocklist) ? cfg!.order_blocklist : [],
    });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let parsed;
    try {
        parsed = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: e?.errors?.[0]?.message || 'Неверные данные' }, { status: 400 });
    }

    // 1) Адреса/активность отделов.
    for (const r of parsed.routes || []) {
        const update: Record<string, any> = { email: r.email ? r.email : null, updated_at: new Date().toISOString() };
        if (typeof r.is_active === 'boolean') update.is_active = r.is_active;
        const { error } = await supabase.from('email_intake_routes').update(update).eq('department', r.department);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2) Режимы (singleton-конфиг).
    const cfgUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof parsed.create_orders === 'boolean') cfgUpdate.create_orders = parsed.create_orders;
    if (typeof parsed.forward_enabled === 'boolean') cfgUpdate.forward_enabled = parsed.forward_enabled;
    if (Array.isArray(parsed.order_blocklist)) cfgUpdate.order_blocklist = normalizeBlocklist(parsed.order_blocklist);
    if (Object.keys(cfgUpdate).length > 1) {
        const { error } = await supabase.from('email_intake_config').update(cfgUpdate).eq('id', true);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
