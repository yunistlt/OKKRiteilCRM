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
 *  Роль определяется ГРУППАМИ менеджера в RetailCRM через salary_role_map
 *  (см. lib/salary/roles.ts): авто при 1 кандидате, выбор пользователя при 2+. */
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

// ── Чтение для UI ────────────────────────────────────────────────────────────

export interface SchemeView {
    code: string;
    name: string;
    effectiveFrom: string;
    blocks: { block_code: string; sort_order: number; params: any; enabled: boolean }[];
}

/** Последние версии всех схем (на дату asOf) с их блоками — для конструктора. */
export async function listSchemes(asOf: string): Promise<SchemeView[]> {
    const { data: schemeRows, error } = await supabase
        .from('salary_scheme')
        .select('id,code,name,effective_from')
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

/** Сохраняет версию схемы (code, effective_from) и её блоки. Перезаписывает блоки версии. */
export async function saveScheme(params: {
    code: string;
    name: string;
    effectiveFrom: string;
    blocks: { block_code: string; params: any; enabled?: boolean }[];
    actor: string | null;
}): Promise<void> {
    const { code, name, effectiveFrom, blocks, actor } = params;
    const { data: upserted, error } = await supabase
        .from('salary_scheme')
        .upsert({ code, name, effective_from: effectiveFrom, created_by: actor }, { onConflict: 'code,effective_from' })
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
    await supabase.from('salary_audit_log').insert({ entity: 'scheme', entity_id: code, action: 'save', actor, old_value: null, new_value: { name, effectiveFrom, blocks } });
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
