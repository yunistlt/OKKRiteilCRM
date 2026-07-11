import { supabase } from '@/utils/supabase';
import type { BlockInstance } from '@/lib/salary/blocks/types';
import { resolveManagerRoles } from '@/lib/salary/roles';

// ============================================================================
// Резолв схем оплаты и планов «на период». Схема — пресет блоков; менеджеру
// назначается схема (effective-dated). Наличие назначения = членство в реестре
// ОП. Резолв зеркалит config.ts: берём последнюю версию с effective_from <= asOf.
// ============================================================================

export interface ManagerComp {
    managerId: number;
    schemeCode: string;
    blocks: BlockInstance[];
}

/** Карта managerId → назначенная схема с блоками, действующая на дату asOf.
 *  Роль = ГРУППА менеджера в RetailCRM напрямую (код схемы = код группы,
 *  см. lib/salary/roles.ts): авто при 1 кандидате, выбор пользователя при 2+. */
export async function resolveManagerComp(asOf: string): Promise<Map<number, ManagerComp>> {
    // 1. Реестр ЗП = отмеченные участники (salary_participant) И имеющие роль из групп RetailCRM
    const { data: partRows, error: partErr } = await supabase.from('salary_participant').select('manager_id');
    if (partErr) throw partErr;
    const participants = new Set<number>(((partRows as any[]) ?? []).map((r) => Number(r.manager_id)));
    const roles = await resolveManagerRoles(asOf);
    const schemeByManager = new Map<number, string>();
    for (const r of roles) {
        if (r.active && r.resolved && participants.has(r.managerId)) schemeByManager.set(r.managerId, r.resolved);
    }
    if (schemeByManager.size === 0) return new Map();

    // 2. Последняя версия каждой используемой схемы
    const codes = Array.from(new Set(schemeByManager.values()));
    const { data: schemeRows, error: schemeErr } = await supabase
        .from('salary_scheme')
        .select('id,code,effective_from')
        .in('code', codes)
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (schemeErr) throw schemeErr;
    const schemeIdByCode = new Map<string, number>();
    for (const s of (schemeRows as any[]) ?? []) {
        if (!schemeIdByCode.has(s.code)) schemeIdByCode.set(s.code, Number(s.id));
    }

    // 3. Блоки этих версий схем
    const schemeIds = Array.from(schemeIdByCode.values());
    const blocksByScheme = new Map<number, BlockInstance[]>();
    if (schemeIds.length) {
        const { data: blockRows, error: blockErr } = await supabase
            .from('salary_scheme_block')
            .select('scheme_id,block_code,sort_order,params,enabled')
            .in('scheme_id', schemeIds)
            .order('sort_order', { ascending: true });
        if (blockErr) throw blockErr;
        for (const b of (blockRows as any[]) ?? []) {
            if (b.enabled === false) continue;
            const sid = Number(b.scheme_id);
            const arr = blocksByScheme.get(sid) ?? [];
            arr.push({ code: b.block_code, params: b.params ?? {} });
            blocksByScheme.set(sid, arr);
        }
    }

    // 4. Сборка
    const result = new Map<number, ManagerComp>();
    for (const [managerId, code] of Array.from(schemeByManager)) {
        const sid = schemeIdByCode.get(code);
        if (sid == null) continue; // версия схемы ещё не действует на дату
        result.set(managerId, { managerId, schemeCode: code, blocks: blocksByScheme.get(sid) ?? [] });
    }
    return result;
}

export interface EngineerComp {
    itemCode: string;
    schemeCode: string;
    blocks: BlockInstance[];
}

/** Карта item_code инженера → назначенная схема с блоками на дату asOf.
 *  Инженеры НЕ пользователи CRM: реестр = опт-ин (salary_engineer_participant) И
 *  назначение схемы (salary_engineer_comp, пофамильно, effective-dated). Схемы —
 *  participant_kind='engineer'. Зеркалит resolveManagerComp, но ключ строковый. */
export async function resolveEngineerComp(asOf: string): Promise<Map<string, EngineerComp>> {
    // 1. Реестр инженеров = отмеченные участники И имеющие назначение схемы
    const { data: partRows, error: partErr } = await supabase.from('salary_engineer_participant').select('item_code');
    if (partErr) throw partErr;
    const participants = new Set<string>(((partRows as any[]) ?? []).map((r) => String(r.item_code)));
    if (participants.size === 0) return new Map();

    const { data: compRows, error: compErr } = await supabase
        .from('salary_engineer_comp')
        .select('item_code,scheme_code,effective_from')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (compErr) throw compErr;
    const schemeByItem = new Map<string, string>();
    for (const r of (compRows as any[]) ?? []) {
        const code = String(r.item_code);
        if (participants.has(code) && !schemeByItem.has(code)) schemeByItem.set(code, String(r.scheme_code));
    }
    if (schemeByItem.size === 0) return new Map();

    // 2. Последняя версия каждой используемой схемы (на дату)
    const codes = Array.from(new Set(schemeByItem.values()));
    const { data: schemeRows, error: schemeErr } = await supabase
        .from('salary_scheme')
        .select('id,code,effective_from')
        .in('code', codes)
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (schemeErr) throw schemeErr;
    const schemeIdByCode = new Map<string, number>();
    for (const s of (schemeRows as any[]) ?? []) {
        if (!schemeIdByCode.has(s.code)) schemeIdByCode.set(s.code, Number(s.id));
    }

    // 3. Блоки этих версий
    const schemeIds = Array.from(schemeIdByCode.values());
    const blocksByScheme = new Map<number, BlockInstance[]>();
    if (schemeIds.length) {
        const { data: blockRows, error: blockErr } = await supabase
            .from('salary_scheme_block')
            .select('scheme_id,block_code,sort_order,params,enabled')
            .in('scheme_id', schemeIds)
            .order('sort_order', { ascending: true });
        if (blockErr) throw blockErr;
        for (const b of (blockRows as any[]) ?? []) {
            if (b.enabled === false) continue;
            const sid = Number(b.scheme_id);
            const arr = blocksByScheme.get(sid) ?? [];
            arr.push({ code: b.block_code, params: b.params ?? {} });
            blocksByScheme.set(sid, arr);
        }
    }

    // 4. Сборка
    const result = new Map<string, EngineerComp>();
    for (const [itemCode, code] of Array.from(schemeByItem)) {
        const sid = schemeIdByCode.get(code);
        if (sid == null) continue;
        result.set(itemCode, { itemCode, schemeCode: code, blocks: blocksByScheme.get(sid) ?? [] });
    }
    return result;
}

// ── Чтение для UI ────────────────────────────────────────────────────────────

export interface SchemeView {
    code: string;
    name: string;
    effectiveFrom: string;
    blocks: { block_code: string; sort_order: number; params: any; enabled: boolean }[];
}

/** Последние версии всех схем (на дату asOf) с их блоками — для конструктора. */
export async function listSchemes(asOf: string, participantKind: 'manager' | 'engineer' = 'manager'): Promise<SchemeView[]> {
    const { data: schemeRows, error } = await supabase
        .from('salary_scheme')
        .select('id,code,name,effective_from')
        .is('archived_at', null)
        .eq('participant_kind', participantKind)
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (error) throw error;
    const latest = new Map<string, { id: number; name: string; effective_from: string }>();
    for (const s of (schemeRows as any[]) ?? []) {
        if (!latest.has(s.code)) latest.set(s.code, { id: Number(s.id), name: s.name, effective_from: s.effective_from });
    }
    const ids = Array.from(latest.values()).map((v) => v.id);
    const blocksByScheme = new Map<number, any[]>();
    if (ids.length) {
        const { data: blockRows } = await supabase
            .from('salary_scheme_block')
            .select('scheme_id,block_code,sort_order,params,enabled')
            .in('scheme_id', ids)
            .order('sort_order', { ascending: true });
        for (const b of (blockRows as any[]) ?? []) {
            const sid = Number(b.scheme_id);
            const arr = blocksByScheme.get(sid) ?? [];
            arr.push({ block_code: b.block_code, sort_order: b.sort_order, params: b.params ?? {}, enabled: b.enabled !== false });
            blocksByScheme.set(sid, arr);
        }
    }
    const result: SchemeView[] = [];
    for (const [code, v] of Array.from(latest)) {
        result.push({ code, name: v.name, effectiveFrom: v.effective_from, blocks: blocksByScheme.get(v.id) ?? [] });
    }
    return result;
}

/** Назначения схем менеджерам (на дату asOf): managerId → schemeCode. */
export async function listAssignments(asOf: string): Promise<{ managerId: number; schemeCode: string }[]> {
    const map = await resolveManagerComp(asOf);
    return Array.from(map.values()).map((c) => ({ managerId: c.managerId, schemeCode: c.schemeCode }));
}

// ── Запись (из «Настроек мотивации») ─────────────────────────────────────────

/** Сохраняет версию схемы (code, effective_from) и её блоки. Перезаписывает блоки версии.
 *  prevEffectiveFrom — дата версии, которую редактировали. Если дата изменилась, версия
 *  ПЕРЕНОСИТСЯ на новую дату (старая строка удаляется), а не создаётся дубль — иначе более
 *  поздняя версия «перебивала» бы новую и в конструкторе (показ последней ≤ сегодня), и в
 *  пересчёте (resolveManagerComp берёт последнюю ≤ начала периода). */
export async function saveScheme(params: {
    code: string;
    name: string;
    effectiveFrom: string;
    prevEffectiveFrom?: string | null;
    blocks: { block_code: string; params: any; enabled?: boolean }[];
    actor: string | null;
    participantKind?: 'manager' | 'engineer';
}): Promise<void> {
    const { code, name, effectiveFrom, prevEffectiveFrom, blocks, actor, participantKind = 'manager' } = params;
    const { data: upserted, error } = await supabase
        .from('salary_scheme')
        .upsert({ code, name, effective_from: effectiveFrom, participant_kind: participantKind, created_by: actor }, { onConflict: 'code,effective_from' })
        .select('id')
        .single();
    if (error) throw error;
    const schemeId = Number(upserted.id);
    await supabase.from('salary_scheme_block').delete().eq('scheme_id', schemeId);
    if (blocks.length) {
        const rows = blocks.map((b, i) => ({ scheme_id: schemeId, block_code: b.block_code, sort_order: i, params: b.params ?? {}, enabled: b.enabled !== false }));
        const { error: bErr } = await supabase.from('salary_scheme_block').insert(rows);
        if (bErr) throw bErr;
    }
    // Перенос даты: удаляем исходную версию этой же схемы, если дата сменилась.
    if (prevEffectiveFrom && prevEffectiveFrom !== effectiveFrom) {
        const { data: oldRows } = await supabase
            .from('salary_scheme')
            .select('id')
            .eq('code', code)
            .eq('effective_from', prevEffectiveFrom)
            .is('archived_at', null);
        for (const old of (oldRows as any[]) ?? []) {
            const oldId = Number(old.id);
            if (oldId === schemeId) continue;
            await supabase.from('salary_scheme_block').delete().eq('scheme_id', oldId);
            await supabase.from('salary_scheme').delete().eq('id', oldId);
        }
    }
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'save', actor, old_value: prevEffectiveFrom ? { effectiveFrom: prevEffectiveFrom } : null, new_value: { name, effectiveFrom, blocks } });
}

/** Архивные роли (схемы) — последняя версия каждого архивированного code. */
export async function listArchivedSchemes(): Promise<{ code: string; name: string; archivedAt: string }[]> {
    const { data, error } = await supabase
        .from('salary_scheme')
        .select('code,name,effective_from,archived_at')
        .not('archived_at', 'is', null)
        .order('effective_from', { ascending: false });
    if (error) throw error;
    const latest = new Map<string, { name: string; archivedAt: string }>();
    for (const s of (data as any[]) ?? []) {
        if (!latest.has(s.code)) latest.set(s.code, { name: s.name, archivedAt: String(s.archived_at) });
    }
    return Array.from(latest).map(([code, v]) => ({ code, name: v.name, archivedAt: v.archivedAt }));
}

/**
 * Использовалась ли роль в уже посчитанной зарплате (есть строка salary_calc,
 * в breakdown которой записан этот schemeCode). Если да — роль нельзя удалять,
 * только архивировать (чтобы не сломать историю и пересчёт прошлых периодов).
 */
export async function isSchemeUsedInCalc(code: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('salary_calc')
        .select('id')
        .eq('breakdown->>schemeCode', code)
        .limit(1);
    if (error) throw error;
    return (((data as any[]) ?? []).length) > 0;
}

/** Архивирует роль (все версии code): прячет из активного конструктора, история сохраняется. */
export async function archiveScheme(params: { code: string; actor: string | null }): Promise<void> {
    const { code, actor } = params;
    const { error } = await supabase
        .from('salary_scheme')
        .update({ archived_at: new Date().toISOString(), archived_by: actor })
        .eq('code', code);
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'archive', actor, old_value: null, new_value: null });
}

/** Восстанавливает роль из архива (все версии code). */
export async function restoreScheme(params: { code: string; actor: string | null }): Promise<void> {
    const { code, actor } = params;
    const { error } = await supabase
        .from('salary_scheme')
        .update({ archived_at: null, archived_by: null })
        .eq('code', code);
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'restore', actor, old_value: null, new_value: null });
}

/**
 * Удаляет роль ИЛИ архивирует её, если по ней уже считалась зарплата за прошлые
 * периоды. При полном удалении сносит все версии (`salary_scheme`), блоки
 * (`salary_scheme_block`, каскад) и назначения (`salary_manager_comp`).
 * Возвращает что именно произошло и сколько назначений снято (при удалении).
 */
export async function deleteOrArchiveScheme(params: { code: string; actor: string | null }): Promise<{ action: 'deleted' | 'archived'; removedAssignments: number }> {
    const { code, actor } = params;
    if (await isSchemeUsedInCalc(code)) {
        await archiveScheme({ code, actor });
        return { action: 'archived', removedAssignments: 0 };
    }
    const { data: assigns } = await supabase.from('salary_manager_comp').select('manager_id').eq('scheme_code', code);
    const removedAssignments = ((assigns as any[]) ?? []).length;
    if (removedAssignments) {
        const { error: aErr } = await supabase.from('salary_manager_comp').delete().eq('scheme_code', code);
        if (aErr) throw aErr;
    }
    // Блоки удалятся каскадом (FK ON DELETE CASCADE), но снимем явно для совместимости.
    const { data: rows } = await supabase.from('salary_scheme').select('id').eq('code', code);
    const ids = ((rows as any[]) ?? []).map((r) => Number(r.id));
    if (ids.length) await supabase.from('salary_scheme_block').delete().in('scheme_id', ids);
    const { error: sErr } = await supabase.from('salary_scheme').delete().eq('code', code);
    if (sErr) throw sErr;
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'delete', actor, old_value: { removedAssignments }, new_value: null });
    return { action: 'deleted', removedAssignments };
}

/** Назначает менеджеру схему с указанной даты (effective-dated). */
export async function assignManagerScheme(params: { managerId: number; schemeCode: string; effectiveFrom: string; actor: string | null }): Promise<void> {
    const { managerId, schemeCode, effectiveFrom, actor } = params;
    const { error } = await supabase
        .from('salary_manager_comp')
        .upsert({ manager_id: managerId, scheme_code: schemeCode, effective_from: effectiveFrom, created_by: actor }, { onConflict: 'manager_id,effective_from' });
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'manager_comp', entity_id: String(managerId), action: 'assign', actor, old_value: null, new_value: { schemeCode, effectiveFrom } });
}

/** Снимает менеджера с реестра ОП (удаляет назначение на дату). */
export async function unassignManager(params: { managerId: number; effectiveFrom: string }): Promise<void> {
    const { managerId, effectiveFrom } = params;
    const { error } = await supabase.from('salary_manager_comp').delete().eq('manager_id', managerId).eq('effective_from', effectiveFrom);
    if (error) throw error;
}

export interface PeriodPlans {
    personal: Map<number, number>; // managerId → target (выручка без НДС)
    department: number | null;
}

/** Планы за месяц для UI (сырьём). */
export async function listPlans(year: number, month: number): Promise<{ manager_id: number | null; target: number }[]> {
    const { data, error } = await supabase
        .from('salary_plan')
        .select('manager_id,target')
        .eq('year', year)
        .eq('month', month)
        .eq('metric', 'revenue_no_vat');
    if (error) throw error;
    return ((data as any[]) ?? []).map((r) => ({ manager_id: r.manager_id == null ? null : Number(r.manager_id), target: Number(r.target) }));
}

/** Сохраняет план (manager_id null = отдел). target null → удалить план. */
export async function savePlan(params: { year: number; month: number; managerId: number | null; target: number | null; actor: string | null }): Promise<void> {
    const { year, month, managerId, target, actor } = params;
    if (target == null) {
        let del = supabase.from('salary_plan').delete().eq('year', year).eq('month', month).eq('metric', 'revenue_no_vat');
        del = managerId == null ? del.is('manager_id', null) : del.eq('manager_id', managerId);
        const { error } = await del;
        if (error) throw error;
        return;
    }
    // upsert вручную (partial unique индексы не работают с onConflict), поэтому select+update/insert
    let q = supabase.from('salary_plan').select('id').eq('year', year).eq('month', month).eq('metric', 'revenue_no_vat');
    q = managerId == null ? q.is('manager_id', null) : q.eq('manager_id', managerId);
    const { data: existing } = await q.maybeSingle();
    if (existing) {
        const { error } = await supabase.from('salary_plan').update({ target, updated_at: new Date().toISOString() }).eq('id', (existing as any).id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('salary_plan').insert({ year, month, manager_id: managerId, metric: 'revenue_no_vat', target, created_by: actor });
        if (error) throw error;
    }
}

/** Планы за месяц (метрика revenue_no_vat). Личные и общий независимы. */
export async function getPlansForPeriod(year: number, month: number): Promise<PeriodPlans> {
    const { data, error } = await supabase
        .from('salary_plan')
        .select('manager_id,target,metric')
        .eq('year', year)
        .eq('month', month)
        .eq('metric', 'revenue_no_vat');
    if (error) throw error;
    const personal = new Map<number, number>();
    let department: number | null = null;
    for (const r of (data as any[]) ?? []) {
        if (r.manager_id == null) department = Number(r.target);
        else personal.set(Number(r.manager_id), Number(r.target));
    }
    return { personal, department };
}

// ── Инженеры-расчётчики: справочник + реестр (опт-ин + назначение схемы) ──────

/** Элементы справочника инженеров (item_code + имя) из retailcrm_dictionaries.
 *  Источник — справочник кастом-поля fieldCode (по закону names-from-retailcrm).
 *  Пусто, если поле/справочник ещё не синхронизированы (/api/sync/dictionaries). */
export async function listEngineerDictionary(fieldCode: string): Promise<{ itemCode: string; name: string }[]> {
    const { data: fieldRow } = await supabase
        .from('retailcrm_custom_fields')
        .select('dictionary')
        .eq('entity', 'order')
        .eq('code', fieldCode)
        .maybeSingle();
    const dictCode = (fieldRow?.dictionary as string) || '';
    if (!dictCode) return [];
    const { data } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code,item_name')
        .eq('entity_type', 'customField')
        .eq('dictionary_code', dictCode)
        .order('item_name', { ascending: true });
    return ((data as any[]) ?? []).map((r) => ({ itemCode: String(r.item_code), name: String(r.item_name || r.item_code) }));
}

export interface EngineerRosterRow {
    itemCode: string;
    name: string;
    inRoster: boolean; // отмечен в опт-ине
    schemeCode: string | null; // назначенная схема на дату
}

/** Реестр инженеров на дату: элементы справочника + флаг опт-ина + назначенная схема. */
export async function listEngineerRoster(asOf: string, fieldCode: string): Promise<EngineerRosterRow[]> {
    const dict = await listEngineerDictionary(fieldCode);
    const { data: partRows } = await supabase.from('salary_engineer_participant').select('item_code');
    const participants = new Set<string>(((partRows as any[]) ?? []).map((r) => String(r.item_code)));
    const { data: compRows } = await supabase
        .from('salary_engineer_comp')
        .select('item_code,scheme_code,effective_from')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    const schemeByItem = new Map<string, string>();
    for (const r of (compRows as any[]) ?? []) {
        const code = String(r.item_code);
        if (!schemeByItem.has(code)) schemeByItem.set(code, String(r.scheme_code));
    }
    return dict.map((d) => ({
        itemCode: d.itemCode,
        name: d.name,
        inRoster: participants.has(d.itemCode),
        schemeCode: schemeByItem.get(d.itemCode) ?? null,
    }));
}

/** Сохраняет реестр инженеров: полный replace опт-ина + назначения схем (effective-dated).
 *  rows — только отмеченные инженеры (с выбранной схемой); остальные снимаются из реестра. */
export async function saveEngineerRoster(params: {
    rows: { itemCode: string; schemeCode: string }[];
    effectiveFrom: string;
    actor: string | null;
}): Promise<void> {
    const { rows, effectiveFrom, actor } = params;
    // Опт-ин: полный replace (как менеджерский saveSalaryRoster).
    await supabase.from('salary_engineer_participant').delete().neq('item_code', ' ');
    if (rows.length) {
        const { error } = await supabase
            .from('salary_engineer_participant')
            .insert(rows.map((r) => ({ item_code: r.itemCode, created_by: actor })));
        if (error) throw error;
    }
    // Назначения схем на дату (upsert по item_code+effective_from).
    for (const r of rows) {
        if (!r.schemeCode) continue;
        const { error } = await supabase
            .from('salary_engineer_comp')
            .upsert({ item_code: r.itemCode, scheme_code: r.schemeCode, effective_from: effectiveFrom, created_by: actor }, { onConflict: 'item_code,effective_from' });
        if (error) throw error;
    }
    await supabase.from('salary_audit_log').insert({ entity: 'engineer_roster', entity_id: effectiveFrom, action: 'save', actor, old_value: null, new_value: { count: rows.length } });
}

/** Удаляет инженерную схему (все версии code); блоки — каскадом по FK. */
export async function deleteEngineerScheme(params: { code: string; actor: string | null }): Promise<void> {
    const { code, actor } = params;
    const { error } = await supabase.from('salary_scheme').delete().eq('code', code).eq('participant_kind', 'engineer');
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'delete', actor, old_value: null, new_value: { participantKind: 'engineer' } });
}
