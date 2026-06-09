import { supabase } from '@/utils/supabase';
import type { BlockInstance } from '@/lib/salary/blocks/types';

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

/** Карта managerId → назначенная схема с блоками, действующая на дату asOf. */
export async function resolveManagerComp(asOf: string): Promise<Map<number, ManagerComp>> {
    // 1. Последнее назначение схемы по каждому менеджеру
    const { data: compRows, error: compErr } = await supabase
        .from('salary_manager_comp')
        .select('manager_id,scheme_code,effective_from')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (compErr) throw compErr;
    const schemeByManager = new Map<number, string>();
    for (const r of (compRows as any[]) ?? []) {
        const mid = Number(r.manager_id);
        if (!schemeByManager.has(mid)) schemeByManager.set(mid, r.scheme_code);
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

export interface PeriodPlans {
    personal: Map<number, number>; // managerId → target (выручка без НДС)
    department: number | null;
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
