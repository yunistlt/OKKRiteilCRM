import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import { collectPeriodMetrics } from '@/lib/salary/metrics';

export const dynamic = 'force-dynamic';

// GET /api/salary/drilldown?period=YYYY-MM&metric=conversion|team&manager_id=N
// Расшифровка показателей расчётной ведомости заказами (ленивая, по клику):
//   conversion — поступившие за месяц заявки менеджера (знаменатель конверсии)
//                с отметкой «продан» (вошёл в засчитанные = числитель);
//   team       — все засчитанные заказы отдела (из чего сложилась выручка отдела
//                под К_команды), с менеджером и выручкой без НДС по каждому.
// admin/rop — любой менеджер/отдел; manager — только своя конверсия (+ список отдела).

function monthBounds(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { start, end };
}

// Имя клиента из CRM (raw_payload), закон «имена из RetailCRM»: компания → ФИО клиента → ФИО контакта.
function clientNameFromPayload(p: any): string | null {
    const cust = p?.customer;
    const contact = p?.contact;
    const nick = typeof cust?.nickName === 'string' ? cust.nickName.trim() : '';
    const custFio = [cust?.firstName, cust?.lastName].filter(Boolean).join(' ').trim();
    const contactFio = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
    return nick || custFio || contactFio || null;
}

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop', 'manager'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const period = searchParams.get('period') || '';
        const metric = searchParams.get('metric') || '';
        const managerIdRaw = searchParams.get('manager_id');
        const pm = period.match(/^(\d{4})-(\d{1,2})$/);
        if (!pm) return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });
        const year = Number(pm[1]);
        const month = Number(pm[2]);

        const role = session?.user?.role;
        const ownManagerId = session?.user?.retail_crm_manager_id ?? null;

        // ── Конверсия: поступившие заявки менеджера + отметка «продан» ──────────
        if (metric === 'conversion') {
            const managerId = managerIdRaw != null ? Number(managerIdRaw) : NaN;
            if (!Number.isFinite(managerId)) {
                return NextResponse.json({ error: 'manager_id обязателен' }, { status: 400 });
            }
            // Менеджер видит только свою конверсию.
            if (role === 'manager' && managerId !== Number(ownManagerId)) {
                return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
            }

            const config = await getConfigForPeriod(year, month);
            const { start, end } = monthBounds(year, month);
            const exclusions: string[] = config.source_exclusions ?? [];
            const closing = config.closing_status.code;

            // Поступившие за период по менеджеру (тот же фильтр, что и знаменатель конверсии).
            const { data: incData, error: incErr } = await supabase
                .from('orders')
                .select('order_id,totalsumm,created_at,raw_payload')
                .gte('created_at', start)
                .lt('created_at', end)
                .eq('manager_id', managerId);
            if (incErr) throw incErr;

            // Засчитанные (вошли в статус закрытия в окне) — числитель; отмечаем «продан».
            const { data: countedData, error: cErr } = await supabase.rpc('salary_counted_orders', {
                p_start: start,
                p_end: end,
                p_closing: closing,
            });
            if (cErr) throw cErr;
            const soldIds = new Set<number>(
                ((countedData as any[]) ?? [])
                    .filter((r) => Number(r.manager_id) === managerId)
                    .map((r) => Number(r.order_id)),
            );

            // Человеческие имена источников заявки (никаких кодов в UI).
            const { data: methodRows } = await supabase
                .from('retailcrm_dictionaries')
                .select('item_code,item_name')
                .eq('entity_type', 'orderMethod');
            const methodName = new Map<string, string>();
            for (const r of (methodRows as any[]) ?? []) methodName.set(r.item_code, r.item_name);

            const orders = ((incData as any[]) ?? [])
                .filter((o) => {
                    const om = String(o.raw_payload?.orderMethod ?? '');
                    return !exclusions.includes(om); // как в salary_incoming_counts
                })
                .map((o) => {
                    const code = o.raw_payload?.orderMethod ? String(o.raw_payload.orderMethod) : '';
                    return {
                        id: Number(o.order_id),
                        clientName: clientNameFromPayload(o.raw_payload),
                        source: code ? methodName.get(code) || code : null,
                        createdAt: o.created_at,
                        sum: Number(o.totalsumm ?? 0) || 0,
                        sold: soldIds.has(Number(o.order_id)),
                    };
                })
                .sort((a, b) => Number(b.sold) - Number(a.sold) || a.id - b.id);

            const soldCount = orders.filter((o) => o.sold).length;
            return NextResponse.json({
                metric: 'conversion',
                incoming: orders.length,
                soldWithinIncoming: soldCount,
                numerator: soldIds.size,
                orders,
            });
        }

        // ── К_команды: все засчитанные заказы отдела (из чего сложилась выручка) ─
        if (metric === 'team') {
            // Список отдела доступен и менеджеру (по решению: прозрачность К_команды).
            const metrics = await collectPeriodMetrics(year, month);

            const managerIds = Array.from(new Set(metrics.managers.map((m) => m.managerId)));
            const namesById = new Map<number, string>();
            if (managerIds.length) {
                const { data: mgrs } = await supabase
                    .from('managers')
                    .select('id,first_name,last_name')
                    .in('id', managerIds);
                for (const mgr of (mgrs as any[]) ?? []) {
                    namesById.set(Number(mgr.id), [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mgr.id}`);
                }
            }

            const orders = metrics.managers
                .flatMap((m) =>
                    m.countedOrders.map((o) => ({
                        id: o.orderId,
                        managerId: m.managerId,
                        managerName: namesById.get(m.managerId) || `#${m.managerId}`,
                        clientName: o.clientName,
                        revenueNoVat: Math.round(o.revenueNoVat),
                        sum: Math.round(o.totalsumm),
                        enteredAt: o.enteredAt,
                    })),
                )
                .sort((a, b) => b.revenueNoVat - a.revenueNoVat);

            return NextResponse.json({
                metric: 'team',
                teamRevenueNoVat: Math.round(metrics.teamRevenueNoVat),
                count: orders.length,
                orders,
            });
        }

        return NextResponse.json({ error: 'Неизвестный показатель' }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
