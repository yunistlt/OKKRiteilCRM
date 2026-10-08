import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Правила юротдела, по которым ИИ-юрисконсульт проверяет договор.
 *
 * Правила живут в базе, а не в коде, чтобы юрист и владелец меняли их сами
 * (закон «без хардкода»). Этот маршрут — их чтение и правка.
 */
const SEVERITIES = ['red', 'watch', 'norm'] as const;

const RuleSchema = z.object({
    id: z.coerce.number().int().positive().optional(),
    topic: z.string().trim().min(2).max(60),
    rule: z.string().trim().min(10).max(2000),
    severity: z.enum(SEVERITIES),
    evidence: z.string().trim().max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function GET() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'jurist'])) {
        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
    }

    const { data, error } = await supabase
        .from('legal_knowledge')
        .select('id, topic, rule, severity, evidence, is_active, created_by, updated_at')
        .order('topic')
        .order('id');

    if (error) return NextResponse.json({ error: 'Не удалось прочитать правила' }, { status: 500 });

    return NextResponse.json({
        rules: (data ?? []).map((r: any) => ({
            id: r.id,
            topic: r.topic,
            rule: r.rule,
            severity: r.severity,
            evidence: r.evidence,
            isActive: r.is_active,
            createdBy: r.created_by,
            updatedAt: r.updated_at,
        })),
    });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'jurist'])) {
        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
    }

    const parsed = RuleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте правило' }, { status: 400 });
    }

    const who = session?.user?.email || session?.user?.username || null;
    const payload = {
        topic: parsed.data.topic,
        rule: parsed.data.rule,
        severity: parsed.data.severity,
        evidence: parsed.data.evidence?.trim() || null,
        is_active: parsed.data.isActive ?? true,
        updated_at: new Date().toISOString(),
    };

    const { error } = parsed.data.id
        ? await supabase.from('legal_knowledge').update(payload).eq('id', parsed.data.id)
        : await supabase.from('legal_knowledge').insert({ ...payload, created_by: who });

    if (error) {
        console.error('[legal-knowledge] не сохранилось:', error);
        return NextResponse.json({ error: 'Правило не сохранилось' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
