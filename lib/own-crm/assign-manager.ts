/**
 * У заявки обязательно есть менеджер.
 *
 * Требование владельца 02.10.2026: заявка без менеджера — сирота, её никто не
 * ведёт, она не попадает ни в план дня, ни в зарплату, ни в разбор ОКК. До
 * этого так могли создаваться заказы, заведённые руками из учётки, у которой
 * нет живого менеджера RetailCRM (админская: номер 999, которого в CRM нет) —
 * за 30 дней таких набралось 4.
 *
 * Порядок выбора повторяет автоприём почты (`lib/email/assign.ts`), чтобы
 * правило было одно на все потоки:
 *   1. менеджер, которого указали, если он живой и активный;
 *   2. владелец клиента — тот, кто вёл его прошлый заказ (по почте/телефону);
 *   3. поровну по нагрузке среди доступных (отпускники пропускаются);
 *   4. если пул пуст — отказ с понятным текстом, а не заказ без менеджера.
 */
import { supabase } from '@/utils/supabase';
import { getAssignmentContext, resolveAssignment } from '@/lib/email/assign';

export type ManagerAssignment = {
    managerId: number;
    /** Как выбрали — это пишем в лог и показываем человеку. */
    reason: string;
};

/** Менеджер, которого примет RetailCRM: он есть в справочнике и активен. */
async function usable(managerId: unknown): Promise<number | null> {
    const id = Number(managerId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const { data } = await supabase
        .from('managers')
        .select('id, active, raw_data')
        .eq('id', id)
        .maybeSingle();

    const row = data as any;
    const known = row && row.raw_data && row.active !== false;
    return known ? id : null;
}

/**
 * Кому отдать новую заявку. Бросает, если назначить некому: заказ без
 * менеджера создавать нельзя.
 */
export async function assignManagerForNewOrder(params: {
    managerId?: number | string | null;
    email?: string | null;
    phone?: string | null;
}): Promise<ManagerAssignment> {
    const asked = await usable(params.managerId);
    if (asked) return { managerId: asked, reason: 'менеджер указан в заявке' };

    const ctx = await getAssignmentContext();
    if (!ctx.pool.length) {
        throw new Error(
            'Заявку некому назначить: пул менеджеров пуст. Добавьте менеджеров в распределение в настройках приёма заявок.',
        );
    }

    const assignment = await resolveAssignment(
        { email: params.email ?? undefined, phone: params.phone ?? undefined },
        ctx,
    );

    const chosen = await usable(assignment.managerId);
    if (chosen) return { managerId: chosen, reason: assignment.reason };

    // Распределение назвало менеджера, которого RetailCRM не примет (уволен,
    // выключен) — берём любого живого из пула, но заявку без владельца не оставляем.
    for (const id of ctx.pool) {
        const fallback = await usable(id);
        if (fallback) {
            return { managerId: fallback, reason: `в пуле остался один живой менеджер (${ctx.managerNames[fallback] || fallback})` };
        }
    }

    throw new Error('Заявку некому назначить: в пуле нет ни одного активного менеджера RetailCRM.');
}
