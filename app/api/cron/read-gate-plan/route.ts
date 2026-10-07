import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { sendNotification } from '@/lib/notify/send';
import { planAllowedForManager } from '@/lib/read-gate/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/read-gate-plan — добивка придержанных планов дня.
 *
 * Утром план не уходит тем, кто ещё не прочитал разбор: разбор идёт перед
 * планом. Как только человек подтвердил прочтение, его план должен прийти —
 * ждать до завтра нельзя, рабочий день уже идёт. Ходим часто (раз в десять
 * минут в рабочие часы), поэтому задержка между подтверждением и планом —
 * минуты.
 */
export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const today = new Date().toISOString().slice(0, 10);
        const { data } = await supabase
            .from('sales_rop_pending_plan')
            .select('id, manager_id, recipient_name, text, manager_chat_id')
            .eq('plan_date', today)
            .is('sent_at', null);

        const pending = (data ?? []) as any[];
        const sent: string[] = [];

        for (const row of pending) {
            if (!(await planAllowedForManager(Number(row.manager_id)))) continue;

            const result = await sendNotification('sales.plan_daily_dm', row.text, {
                managerId: Number(row.manager_id),
                managerChatId: row.manager_chat_id ?? null,
                fallbackToGroup: true,
            } as any);
            if (result.sent) {
                await supabase
                    .from('sales_rop_pending_plan')
                    .update({ sent_at: new Date().toISOString() })
                    .eq('id', row.id);
                sent.push(String(row.recipient_name ?? row.manager_id));
            }
        }

        return NextResponse.json({ ok: true, pending: pending.length, sent });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
