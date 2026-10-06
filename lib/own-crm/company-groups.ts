/**
 * Группы компаний: несколько юрлиц одного покупателя — один клиент.
 *
 * Решение владельца 06.10.2026. Склейки карточек по ИНН не хватает: у
 * белорусов ИНН нет вовсе (у них УНП), а разные юрлица одного владельца по ИНН
 * не склеить в принципе. Группы ведут менеджеры руками — автоподбора нет.
 *
 * Карточки лежат в двух таблицах: `clients` — наши, `customers` — приехавшие
 * из RetailCRM. Поэтому участник хранится номером, без внешнего ключа, а имена
 * собираются из обеих таблиц.
 */
import { supabase } from '@/utils/supabase';

export interface GroupMember {
    clientId: number;
    name: string;
    inn: string | null;
    /** Сделок по карточке — чтобы было видно, что объединяем. */
    deals: number;
}

export interface CompanyGroup {
    id: number;
    name: string;
    note: string | null;
    members: GroupMember[];
}

/** Статусы, в которых заказ считается состоявшейся сделкой (как в зарплате). */
const DEAL_STATUSES = ['send-assembling', 'otgruzen', 'complete', 'delivering', 'send-to-delivery', 'reklamac'];

/** Имена и ИНН карточек из обеих таблиц. */
async function cardNames(ids: number[]): Promise<Map<number, { name: string; inn: string | null }>> {
    const out = new Map<number, { name: string; inn: string | null }>();
    if (!ids.length) return out;

    const [own, crm] = await Promise.all([
        supabase.from('clients').select('id, company_name, first_name, last_name, inn').in('id', ids),
        supabase.from('customers').select('id, nickName, firstName, lastName').in('id', ids),
    ]);

    for (const row of ((own.data ?? []) as any[])) {
        const name = row.company_name || [row.last_name, row.first_name].filter(Boolean).join(' ') || `Карточка №${row.id}`;
        out.set(Number(row.id), { name, inn: row.inn ?? null });
    }
    for (const row of ((crm.data ?? []) as any[])) {
        if (out.has(Number(row.id))) continue;
        const name = row.nickName || [row.lastName, row.firstName].filter(Boolean).join(' ') || `Карточка №${row.id}`;
        out.set(Number(row.id), { name, inn: null });
    }
    return out;
}

/** Сколько состоявшихся сделок у каждой карточки. */
async function dealCounts(ids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!ids.length) return out;

    const { data } = await supabase
        .from('orders')
        .select('raw_payload->customer->>id')
        .in('status', DEAL_STATUSES)
        .is('crm_deleted_at', null)
        .in('raw_payload->customer->>id', ids.map(String));

    for (const row of ((data ?? []) as any[])) {
        const id = Number(Object.values(row)[0]);
        if (!Number.isFinite(id)) continue;
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

/** Группа, в которой состоит карточка. Null — карточка сама по себе. */
export async function groupOfClient(clientId: number): Promise<CompanyGroup | null> {
    const { data: membership } = await supabase
        .from('company_group_members')
        .select('group_id')
        .eq('client_id', clientId)
        .maybeSingle();

    const groupId = Number((membership as any)?.group_id);
    if (!Number.isFinite(groupId)) return null;

    return loadGroup(groupId);
}

/** Группа со всеми участниками. */
export async function loadGroup(groupId: number): Promise<CompanyGroup | null> {
    const { data: group } = await supabase
        .from('company_groups')
        .select('id, name, note')
        .eq('id', groupId)
        .maybeSingle();
    if (!group) return null;

    const { data: rows } = await supabase
        .from('company_group_members')
        .select('client_id')
        .eq('group_id', groupId);

    const ids = ((rows ?? []) as any[]).map((r) => Number(r.client_id)).filter(Number.isFinite);
    const [names, deals] = await Promise.all([cardNames(ids), dealCounts(ids)]);

    return {
        id: Number((group as any).id),
        name: String((group as any).name),
        note: (group as any).note ?? null,
        members: ids
            .map((id) => ({
                clientId: id,
                name: names.get(id)?.name ?? `Карточка №${id}`,
                inn: names.get(id)?.inn ?? null,
                deals: deals.get(id) ?? 0,
            }))
            .sort((a, b) => b.deals - a.deals),
    };
}

/**
 * Добавить в группу текущей карточки выбранные компании.
 *
 * Группы ещё нет — заводим её здесь же: менеджер выбрал компании, спрашивать
 * его о названии отдельно незачем (решение владельца 06.10.2026 — «сами
 * ручками выберут поиском из списка», без лишних шагов).
 */
export async function addCompanies(
    clientId: number,
    companyIds: number[],
    groupName: string,
    actor: string | null,
): Promise<CompanyGroup | null> {
    const ids = Array.from(new Set(companyIds.map(Number).filter(Number.isFinite)));

    let group = await groupOfClient(clientId);
    if (!group) {
        group = await createGroup(groupName, clientId, actor);
    }
    for (const id of ids) {
        if (id === clientId) continue;
        await addToGroup(group.id, id, actor);
    }
    return loadGroup(group.id);
}

/** Завести группу и положить в неё карточку. */
export async function createGroup(name: string, clientId: number, actor: string | null): Promise<CompanyGroup> {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('У группы должно быть название');

    const { data: group, error } = await supabase
        .from('company_groups')
        .insert({ name: clean, created_by: actor })
        .select('id')
        .maybeSingle();
    if (error) throw new Error(error.message);

    const groupId = Number((group as any).id);
    await addToGroup(groupId, clientId, actor);
    return (await loadGroup(groupId))!;
}

/**
 * Добавить карточку в группу. Карточка состоит максимум в одной группе —
 * иначе «кто покупатель» перестаёт быть однозначным и расчёты разъедутся.
 */
export async function addToGroup(groupId: number, clientId: number, actor: string | null): Promise<void> {
    const { error } = await supabase
        .from('company_group_members')
        .upsert({ group_id: groupId, client_id: clientId, added_by: actor }, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
}

/** Убрать карточку из группы. Пустая группа удаляется — висеть ей незачем. */
export async function removeFromGroup(clientId: number): Promise<void> {
    const { data: row } = await supabase
        .from('company_group_members')
        .select('group_id')
        .eq('client_id', clientId)
        .maybeSingle();

    const groupId = Number((row as any)?.group_id);
    await supabase.from('company_group_members').delete().eq('client_id', clientId);

    if (!Number.isFinite(groupId)) return;
    const { data: left } = await supabase.from('company_group_members').select('client_id').eq('group_id', groupId);
    if (!((left ?? []) as any[]).length) {
        await supabase.from('company_groups').delete().eq('id', groupId);
    }
}

/** Поиск групп по названию — чтобы присоединить карточку к уже заведённой. */
export async function searchGroups(text: string, limit = 10): Promise<Array<{ id: number; name: string; members: number }>> {
    const clean = String(text ?? '').trim();
    let q = supabase.from('company_groups').select('id, name').limit(limit);
    if (clean) q = q.ilike('name', `%${clean}%`);

    const { data } = await q;
    const groups = ((data ?? []) as any[]).map((g) => ({ id: Number(g.id), name: String(g.name) }));
    if (!groups.length) return [];

    const { data: rows } = await supabase
        .from('company_group_members')
        .select('group_id')
        .in('group_id', groups.map((g) => g.id));

    const counts = new Map<number, number>();
    for (const r of ((rows ?? []) as any[])) {
        const id = Number(r.group_id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return groups.map((g) => ({ ...g, members: counts.get(g.id) ?? 0 }));
}
