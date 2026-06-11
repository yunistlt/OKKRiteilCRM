import { supabase } from '@/utils/supabase';

// ============================================================================
// Роль (схема ЗП) менеджера = ГРУППА пользователя в RetailCRM напрямую:
// код схемы (salary_scheme.code) = код группы RetailCRM (managers.raw_data.groups[].code).
// Группа считается ролью, только если для неё заведена схема. Закон: роли из СРМ.
//   0 групп-схем → не в реестре; 1 → авто; 2+ → выбор пользователя (из этих ролей).
// Выбор для 2+ хранится в salary_manager_comp (используется только при конфликте).
// ============================================================================

export interface ManagerRole {
    managerId: number;
    name: string;
    active: boolean;
    groups: { code: string; name: string }[]; // все группы менеджера из RetailCRM
    candidates: string[]; // коды схем-кандидатов = группы, для которых заведена схема
    resolved: string | null; // итог: авто (1) или выбор пользователя (2+), иначе null
    needsChoice: boolean; // 2+ кандидата и валидный выбор ещё не сделан
}

/** Коды схем (ролей), действующих на дату — это и есть допустимые коды групп-ролей. */
async function getSchemeCodes(asOf: string): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('salary_scheme')
        .select('code,effective_from')
        .lte('effective_from', asOf);
    if (error) throw error;
    return new Set(((data as any[]) ?? []).map((r) => String(r.code)));
}

/** Роли всех менеджеров на дату asOf (кандидаты = группы, для которых есть схема). */
export async function resolveManagerRoles(asOf: string): Promise<ManagerRole[]> {
    const schemeCodes = await getSchemeCodes(asOf);

    const { data: mgrs, error: mErr } = await supabase
        .from('managers')
        .select('id,first_name,last_name,active,raw_data');
    if (mErr) throw mErr;

    // Выбор пользователя для конфликтных (2+) — последний на дату.
    const { data: compRows } = await supabase
        .from('salary_manager_comp')
        .select('manager_id,scheme_code,effective_from')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    const choice = new Map<number, string>();
    for (const r of (compRows as any[]) ?? []) {
        const mid = Number(r.manager_id);
        if (!choice.has(mid)) choice.set(mid, r.scheme_code);
    }

    const out: ManagerRole[] = [];
    for (const m of (mgrs as any[]) ?? []) {
        const rawGroups: any[] = Array.isArray(m.raw_data?.groups) ? m.raw_data.groups : [];
        const groups = rawGroups.map((g) => ({ code: String(g.code), name: g.name ?? String(g.code) }));
        // кандидат-роль = группа, для которой заведена схема (код схемы = код группы)
        const candidates = Array.from(new Set(groups.map((g) => g.code).filter((c) => schemeCodes.has(c))));
        let resolved: string | null = null;
        let needsChoice = false;
        if (candidates.length === 1) {
            resolved = candidates[0];
        } else if (candidates.length > 1) {
            const c = choice.get(Number(m.id));
            if (c && candidates.includes(c)) resolved = c;
            else needsChoice = true;
        }
        out.push({
            managerId: Number(m.id),
            name: `${m.last_name ?? ''} ${m.first_name ?? ''}`.trim() || `#${m.id}`,
            active: !!m.active,
            groups,
            candidates,
            resolved,
            needsChoice,
        });
    }
    return out;
}

/** Сохраняет выбор схемы пользователем для конфликтного (2+ кандидата) менеджера. */
export async function setManagerRoleChoice(params: {
    managerId: number;
    schemeCode: string;
    effectiveFrom: string;
    actor: string | null;
}): Promise<void> {
    const { managerId, schemeCode, effectiveFrom, actor } = params;
    const { error } = await supabase
        .from('salary_manager_comp')
        .upsert({ manager_id: managerId, scheme_code: schemeCode, effective_from: effectiveFrom, created_by: actor }, { onConflict: 'manager_id,effective_from' });
    if (error) throw error;
}

/** Справочник групп пользователей RetailCRM (для выбора роли при создании схемы). */
export async function listRetailcrmGroups(): Promise<{ code: string; name: string }[]> {
    const { data, error } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code,item_name')
        .eq('entity_type', 'userGroup')
        .order('item_name', { ascending: true });
    if (error) throw error;
    return ((data as any[]) ?? []).map((r) => ({ code: r.item_code, name: r.item_name }));
}
