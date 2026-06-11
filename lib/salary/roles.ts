import { supabase } from '@/utils/supabase';

// ============================================================================
// Роль (схема ЗП) менеджера = ГРУППЫ пользователя в RetailCRM (managers.raw_data.groups)
// через маппинг salary_role_map (группа → схема). Закон: роль из СРМ, не вручную.
//   0 кандидатов → не в реестре; 1 → авто; 2+ → выбор пользователя (из этих ролей).
// Выбор для 2+ хранится в salary_manager_comp (используется только при конфликте).
// ============================================================================

export interface ManagerRole {
    managerId: number;
    name: string;
    active: boolean;
    groups: { code: string; name: string }[]; // группы из RetailCRM (для отображения)
    candidates: string[]; // коды схем-кандидатов из групп через маппинг
    resolved: string | null; // итоговая схема: авто (1 кандидат) или выбор пользователя (2+), иначе null
    needsChoice: boolean; // 2+ кандидата и валидный выбор ещё не сделан
}

/** Маппинг код-группы RetailCRM → код схемы ЗП. */
export async function getRoleMap(): Promise<Map<string, string>> {
    const { data, error } = await supabase.from('salary_role_map').select('retailcrm_group_code,scheme_code');
    if (error) throw error;
    const m = new Map<string, string>();
    for (const r of (data as any[]) ?? []) m.set(r.retailcrm_group_code, r.scheme_code);
    return m;
}

/** Роли всех менеджеров на дату asOf (кандидаты из групп + итоговая схема). */
export async function resolveManagerRoles(asOf: string): Promise<ManagerRole[]> {
    const roleMap = await getRoleMap();

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
        const candidates = Array.from(
            new Set(groups.map((g) => roleMap.get(g.code)).filter((x): x is string => !!x)),
        );
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

/** Обновляет маппинг группа→схема (полная замена набора строк). */
export async function saveRoleMap(rows: { groupCode: string; schemeCode: string }[], actor: string | null): Promise<void> {
    const clean = rows.filter((r) => r.groupCode && r.schemeCode);
    const { error: delErr } = await supabase.from('salary_role_map').delete().neq('retailcrm_group_code', '');
    if (delErr) throw delErr;
    if (clean.length) {
        const { error } = await supabase
            .from('salary_role_map')
            .insert(clean.map((r) => ({ retailcrm_group_code: r.groupCode, scheme_code: r.schemeCode, created_by: actor })));
        if (error) throw error;
    }
}

/** Все группы пользователей RetailCRM (для дропдауна маппинга) — из managers.raw_data.groups. */
export async function listRetailcrmGroups(): Promise<{ code: string; name: string }[]> {
    const { data, error } = await supabase.from('managers').select('raw_data');
    if (error) throw error;
    const map = new Map<string, string>();
    for (const m of (data as any[]) ?? []) {
        for (const g of (Array.isArray(m.raw_data?.groups) ? m.raw_data.groups : [])) {
            if (g?.code) map.set(String(g.code), g.name ?? String(g.code));
        }
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
