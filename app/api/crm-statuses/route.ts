import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Статусы будущей внутренней CRM: свои группы, свои статусы, свои правила переходов.
 * Синк RetailCRM здесь не участвует — сопоставление сделаем отдельно через external_code.
 */
export async function GET() {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const [{ data: groups }, { data: statuses }, { data: transitions }] = await Promise.all([
        supabase.from('crm_status_groups').select('*').order('ordering').order('name'),
        supabase.from('crm_statuses').select('*').order('ordering').order('name'),
        supabase.from('crm_status_transitions').select('from_status_id, to_status_id'),
    ]);

    return NextResponse.json({
        ok: true,
        groups: groups || [],
        statuses: statuses || [],
        transitions: ((transitions || []) as any[]).map((t) => `${t.from_status_id}>${t.to_status_id}`),
    });
}

const GroupSchema = z.object({
    kind: z.literal('group'),
    id: z.string().uuid().optional(),
    code: z.string().regex(/^[a-z0-9_-]{2,60}$/).optional(),
    name: z.string().min(1).max(120),
    color: z.string().max(20).nullable().optional(),
    ordering: z.number().int().optional(),
    active: z.boolean().optional(),
    members: z.array(z.string().uuid()).optional(),   // состав группы
});

const StatusSchema = z.object({
    kind: z.literal('status'),
    id: z.string().uuid().optional(),
    code: z.string().regex(/^[a-z0-9_-]{2,60}$/).optional(),
    name: z.string().min(1).max(120),
    groupId: z.string().uuid().nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    ordering: z.number().int().optional(),
    normDays: z.number().int().nonnegative().nullable().optional(),
    isWorking: z.boolean().optional(),
    active: z.boolean().optional(),
});

const TransitionsSchema = z.object({
    kind: z.literal('transitions'),
    pairs: z.array(z.string()),
});

const BodySchema = z.discriminatedUnion('kind', [GroupSchema, StatusSchema, TransitionsSchema]);

export async function PUT(req: Request) {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    if (body.kind === 'group') {
        const row: Record<string, any> = { name: body.name, updated_at: new Date().toISOString() };
        if (body.color !== undefined) row.color = body.color;
        if (body.ordering !== undefined) row.ordering = body.ordering;
        if (body.active !== undefined) row.active = body.active;

        let groupId = body.id;
        if (groupId) {
            const { error } = await supabase.from('crm_status_groups').update(row).eq('id', groupId);
            if (error) return NextResponse.json({ error: 'update_failed', details: error.message }, { status: 500 });
        } else {
            row.code = body.code || slug(body.name);
            const { data, error } = await supabase.from('crm_status_groups').insert(row).select('id').single();
            if (error) return NextResponse.json({ error: 'insert_failed', details: error.message }, { status: 500 });
            groupId = data.id;
        }

        if (body.members) {
            // Состав группы задаётся целиком: отмеченные переносим сюда, снятые оставляем без группы.
            const { error: clearError } = await supabase
                .from('crm_statuses')
                .update({ group_id: null, updated_at: new Date().toISOString() })
                .eq('group_id', groupId);
            if (clearError) return NextResponse.json({ error: 'group_clear_failed', details: clearError.message }, { status: 500 });

            if (body.members.length) {
                const { error } = await supabase
                    .from('crm_statuses')
                    .update({ group_id: groupId, updated_at: new Date().toISOString() })
                    .in('id', body.members);
                if (error) return NextResponse.json({ error: 'group_assign_failed', details: error.message }, { status: 500 });
            }
        }

        return NextResponse.json({ ok: true, id: groupId });
    }

    if (body.kind === 'status') {
        const row: Record<string, any> = { name: body.name, updated_at: new Date().toISOString() };
        if (body.groupId !== undefined) row.group_id = body.groupId;
        if (body.color !== undefined) row.color = body.color;
        if (body.ordering !== undefined) row.ordering = body.ordering;
        if (body.normDays !== undefined) row.norm_days = body.normDays;
        if (body.isWorking !== undefined) row.is_working = body.isWorking;
        if (body.active !== undefined) row.active = body.active;

        if (body.id) {
            const { error } = await supabase.from('crm_statuses').update(row).eq('id', body.id);
            if (error) return NextResponse.json({ error: 'update_failed', details: error.message }, { status: 500 });
            return NextResponse.json({ ok: true, id: body.id });
        }

        row.code = body.code || slug(body.name);
        const { data, error } = await supabase.from('crm_statuses').insert(row).select('id').single();
        if (error) {
            const duplicate = error.code === '23505';
            return NextResponse.json(
                { error: duplicate ? 'code_taken' : 'insert_failed', details: error.message },
                { status: duplicate ? 409 : 500 }
            );
        }
        return NextResponse.json({ ok: true, id: data.id });
    }

    // Матрицу переходов пишем целиком — так она всегда согласована с экраном.
    const { error: delError } = await supabase.from('crm_status_transitions').delete().not('from_status_id', 'is', null);
    if (delError) return NextResponse.json({ error: 'clear_failed', details: delError.message }, { status: 500 });

    const rows = body.pairs
        .map((p) => p.split('>'))
        .filter(([from, to]) => from && to)
        .map(([from_status_id, to_status_id]) => ({ from_status_id, to_status_id }));

    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('crm_status_transitions').insert(rows.slice(i, i + 500));
        if (error) return NextResponse.json({ error: 'insert_failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, saved: rows.length });
}

export async function DELETE(req: Request) {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const kind = url.searchParams.get('kind');
    if (!id || (kind !== 'status' && kind !== 'group')) {
        return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    const table = kind === 'status' ? 'crm_statuses' : 'crm_status_groups';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return NextResponse.json({ error: 'delete_failed', details: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}

/** Код из названия: латиница по умолчанию, кириллица транслитом — коды латиницей читаемее в URL. */
function slug(name: string): string {
    const map: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
        к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
        х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    };
    const base = name.toLowerCase().split('').map((c) => map[c] ?? c).join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return base || `status-${Date.now()}`;
}
