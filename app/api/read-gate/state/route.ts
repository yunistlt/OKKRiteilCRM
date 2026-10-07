import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { gateState, openGate } from '@/lib/read-gate/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/read-gate/state — что человек обязан прочитать прямо сейчас.
 * Заодно заводит ряд: страница документа открыта, время пошло.
 */
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const user = session.user;
    const state = await gateState(user.id, user.role, user.retail_crm_manager_id ?? null);
    if (!state.blocked) return NextResponse.json({ blocked: false, reason: state.reason });

    const row = await openGate(user.id, state.document, state.settings);
    return NextResponse.json({
        blocked: true,
        gate: {
            id: row.id,
            requiredSeconds: row.required_seconds,
            visibleSeconds: row.visible_seconds,
            scrolledToEnd: row.scrolled_to_end,
            deferUsedToday: !!row.deferred_at,
        },
        document: state.document,
        deferMinutes: state.settings.deferMinutes,
    });
}
