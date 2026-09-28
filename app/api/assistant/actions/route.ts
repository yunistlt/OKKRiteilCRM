import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { runAssistantAction, cancelAssistantAction } from '@/lib/assistant/run-action';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Действия помощника, ожидающие решения менеджера.
 *
 * Помощник их только готовит; письмо уходит клиенту и телефон звонит лишь после того,
 * как человек нажал кнопку здесь.
 */
function managerIdOf(session: any): number | null {
    const id = session?.user?.retail_crm_manager_id;
    return id ? Number(id) : null;
}

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const managerId = managerIdOf(session);
    if (!managerId) {
        return NextResponse.json({
            ok: true,
            actions: [],
            // Без привязки к менеджеру действовать не от кого: письмо уйдёт ни от чьего
            // имени, звонок поднимет ничей аппарат.
            unavailableReason: 'К вашей учётной записи не привязан менеджер — помощник не может действовать от вашего имени.',
        });
    }

    const { data, error } = await supabase
        .from('assistant_actions')
        .select('id, kind, preview, order_number, created_at')
        .eq('manager_id', managerId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('[assistant-actions] Не удалось прочитать очередь:', error);
        return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, actions: data || [] });
}

const BodySchema = z.object({
    actionId: z.string().uuid(),
    decision: z.enum(['confirm', 'cancel']),
});

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const managerId = managerIdOf(session);
    if (!managerId) {
        return NextResponse.json({ error: 'manager_not_linked' }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
        body = BodySchema.parse(await req.json());
    } catch (e: any) {
        return NextResponse.json({ error: 'invalid_body', details: e?.errors ?? String(e) }, { status: 400 });
    }

    if (body.decision === 'cancel') {
        const cancelled = await cancelAssistantAction(body.actionId, managerId);
        return cancelled
            ? NextResponse.json({ ok: true, message: 'Отменено.' })
            : NextResponse.json({ error: 'cancel_failed' }, { status: 409 });
    }

    const result = await runAssistantAction(body.actionId, managerId);
    return NextResponse.json({ ok: result.ok, message: result.message }, { status: result.ok ? 200 : 409 });
}
