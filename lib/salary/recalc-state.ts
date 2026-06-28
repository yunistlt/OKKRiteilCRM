import { supabase } from '@/utils/supabase';

// Определяет, устарел ли сохранённый расчёт периода относительно изменений мотивации.
// Сигнал: мотивацию (схемы/назначения/конфиг/грейды/планы) меняли ПОЗЖЕ, чем был
// сделан последний расчёт (salary_calc.computed_at). Тогда показанные суммы неверны и
// период нужно пересчитать. Закрытый период заморожен — не предлагаем пересчёт.
//
// Почему аудит-лог, а не created_at схемы: saveScheme делает upsert по (code, effective_from),
// и при правке существующей версии created_at НЕ обновляется, а у salary_scheme_block отметок
// времени нет. salary_audit_log же пишет свежую запись на каждое изменение — это надёжно.

export interface RecalcState {
    needsRecalc: boolean;
    computedAt: string | null;
    changedAt: string | null;
}

const NOT_STALE: RecalcState = { needsRecalc: false, computedAt: null, changedAt: null };

function nextMonthFirst(year: number, month: number): string {
    const y = month === 12 ? year + 1 : year;
    const mo = month === 12 ? 1 : month + 1;
    return `${y}-${String(mo).padStart(2, '0')}-01`;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

export async function getRecalcState(periodId: number, status: string, year: number, month: number): Promise<RecalcState> {
    if (status !== 'open') return NOT_STALE;

    // Когда последний раз считали период (макс computed_at среди строк).
    const { data: calcRows } = await supabase
        .from('salary_calc')
        .select('computed_at')
        .eq('period_id', periodId)
        .order('computed_at', { ascending: false })
        .limit(1);
    const computedAt: string | null = (calcRows as any[])?.[0]?.computed_at ?? null;
    // Расчёта вовсе нет — это не «устаревший», а «ещё не считали» (свой пустой экран).
    if (!computedAt) return NOT_STALE;

    const periodEndExcl = nextMonthFirst(year, month);
    const times: string[] = [];

    // Схемы и назначения: только версии, действующие на этот период (effective_from до конца месяца).
    // Так правка прошлой/текущей версии метит период, а заведение будущей (напр. с июля) — нет.
    const { data: schemeLog } = await supabase
        .from('salary_audit_log')
        .select('created_at,new_value')
        .in('entity', ['scheme', 'manager_comp'])
        .order('created_at', { ascending: false })
        .limit(300);
    for (const r of (schemeLog as any[]) ?? []) {
        const eff = (r?.new_value as any)?.effectiveFrom;
        if (!eff || String(eff) < periodEndExcl) times.push(r.created_at);
    }

    // Базовый конфиг и грейды — берём самое свежее изменение (эффективность учесть сложнее, допускаем лёгкий перестраховочный перезапрос).
    const { data: cfgLog } = await supabase
        .from('salary_audit_log')
        .select('created_at')
        .in('entity', ['config', 'grade'])
        .order('created_at', { ascending: false })
        .limit(1);
    if ((cfgLog as any[])?.[0]?.created_at) times.push((cfgLog as any[])[0].created_at);

    // Планы этого месяца (в аудит-лог не пишутся — берём прямые отметки времени строк).
    const { data: plans } = await supabase
        .from('salary_plan')
        .select('created_at,updated_at')
        .eq('year', year)
        .eq('month', month);
    for (const p of (plans as any[]) ?? []) {
        if (p.created_at) times.push(p.created_at);
        if (p.updated_at) times.push(p.updated_at);
    }

    let changedAt: string | null = null;
    for (const t of times) if (!changedAt || ms(t) > ms(changedAt)) changedAt = t;

    const needsRecalc = changedAt != null && ms(changedAt) > ms(computedAt);
    return { needsRecalc, computedAt, changedAt };
}
