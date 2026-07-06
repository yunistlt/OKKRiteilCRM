/**
 * Прогноз ЗП менеджеров ОП при разных выручках отдела.
 * Берёт РЕАЛЬНЫЕ метрики baseline-месяца из БД (RPC, как боевой движок),
 * прогоняет их через те же чистые функции расчёта (compose/computeManagerSalary),
 * сверяет с фактом, затем масштабирует объём по сетке выручки и выгружает JSON.
 *
 * Допущения прогноза (явно): при росте выручки растёт ОБЪЁМ (число заказов),
 * а средний чек, доли new/постоянных, доли категорий, качество ОКК, конверсия %,
 * скидочная метрика, доля «в день обращения» — держатся на реальном уровне baseline.
 * Дежурства фиксированы. Грейд — текущий из леджера.
 */
import postgres from 'postgres';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { validateConfigValue, SALARY_CONFIG_KEYS, type SalaryConfig } from '@/lib/salary/config';
import { buildPeriodMetrics, type ManagerMetrics, type CountedOrder, type CountedOrderRow } from '@/lib/salary/metrics';
import { computeManagerSalary, businessDaysInMonth } from '@/lib/salary/engine';
import type { BlockInstance } from '@/lib/salary/blocks/types';
import { toSimBase, computeScenarioFot } from '@/lib/salary/sim-shared';

dotenv.config({ path: '.env.local' });
const sql = postgres(process.env.DATABASE_URL!);

const YEAR = 2026, MONTH = 5; // baseline = май 2026 (последний полный месяц)
const ASOF = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`;
const SCHEME = 'menedzhery';
// 2D: план отдела (млн ₽) × выполнение плана (%)
const PLAN_GRID = [10, 12, 14, 16, 18, 20].map((m) => m * 1_000_000);
const ATTAIN_GRID = [75, 80, 85, 90, 95, 100, 105, 110, 115, 120];

async function resolveConfig(asOf: string): Promise<SalaryConfig> {
    const rows = await sql`select key, value, effective_from from salary_config where effective_from <= ${asOf} order by effective_from desc`;
    const latest = new Map<string, unknown>();
    for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
    const cfg = {} as SalaryConfig;
    for (const key of SALARY_CONFIG_KEYS) {
        if (!latest.has(key)) throw new Error(`Конфиг ЗП не задан: ${key}`);
        (cfg as any)[key] = validateConfigValue(key, latest.get(key));
    }
    return cfg;
}

async function loadBlocks(code: string, asOf: string): Promise<BlockInstance[]> {
    const rows = await sql`
        select b.block_code, b.params, b.enabled, b.sort_order
        from salary_scheme s join salary_scheme_block b on b.scheme_id = s.id
        where s.code = ${code} and s.archived_at is null
          and s.effective_from = (select max(effective_from) from salary_scheme s2 where s2.code = ${code} and s2.effective_from <= ${asOf})
        order by b.sort_order`;
    return rows.filter((r) => r.enabled !== false).map((r) => ({ code: r.block_code, params: r.params ?? {} }));
}

async function collectRealMetrics(config: SalaryConfig) {
    const start = ASOF;
    const end = `${MONTH === 12 ? YEAR + 1 : YEAR}-${String(MONTH === 12 ? 1 : MONTH + 1).padStart(2, '0')}-01`;
    const closing = config.closing_status.code;

    const rows = (await sql`select * from salary_counted_orders(${start}, ${end}, ${closing})`) as unknown as CountedOrderRow[];

    const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((x): x is number => x != null)));
    const clientDeals = new Map<number, number>();
    if (clientIds.length) {
        const d = await sql`select * from salary_client_deal_counts(${sql.array(clientIds)}::bigint[], ${closing})`;
        for (const r of d) clientDeals.set(Number(r.client_id), Number(r.deals));
    }

    const inc = await sql`select * from salary_incoming_counts(${start}, ${end}, ${sql.array(config.source_exclusions)}::text[])`;
    const incomingByManager = new Map<number, number>();
    for (const r of inc) if (r.manager_id != null) incomingByManager.set(Number(r.manager_id), Number(r.incoming));

    const scores = await sql`select manager_id,total_score,script_score_pct,lead_in_work_lt_1_day,tz_received from okk_order_scores where eval_date >= ${start} and eval_date < ${end}`;
    const agg = new Map<number, { ss: number; ns: number; sc: number; nc: number; f: number; nf: number; fd: number; nfd: number }>();
    const g = (id: number) => { const a = agg.get(id) ?? { ss: 0, ns: 0, sc: 0, nc: 0, f: 0, nf: 0, fd: 0, nfd: 0 }; agg.set(id, a); return a; };
    for (const s of scores) {
        if (s.manager_id == null) continue;
        const a = g(Number(s.manager_id));
        if (s.total_score != null) { a.ss += Number(s.total_score); a.ns++; }
        if (s.script_score_pct != null) { a.sc += Number(s.script_score_pct); a.nc++; }
        if (s.lead_in_work_lt_1_day != null) { a.f += s.lead_in_work_lt_1_day ? 1 : 0; a.nf++; }
        if (s.tz_received != null) { a.fd += s.tz_received ? 1 : 0; a.nfd++; }
    }
    const qualityByManager = new Map<number, number>(), scriptByManager = new Map<number, number>(),
        fastContactByManager = new Map<number, number>(), fieldsByManager = new Map<number, number>();
    for (const [id, a] of agg) {
        if (a.ns) qualityByManager.set(id, a.ss / a.ns);
        if (a.nc) scriptByManager.set(id, a.sc / a.nc);
        if (a.nf) fastContactByManager.set(id, (a.f / a.nf) * 100);
        if (a.nfd) fieldsByManager.set(id, (a.fd / a.nfd) * 100);
    }

    const duties = await sql`select manager_id,shifts,kind from salary_duty where work_date >= ${start} and work_date < ${end}`;
    const dutyByManager = new Map<number, number>(), workedDaysByManager = new Map<number, number>();
    for (const d of duties) {
        if (d.manager_id == null) continue;
        const id = Number(d.manager_id);
        if (d.kind === 'worked_day') workedDaysByManager.set(id, (workedDaysByManager.get(id) ?? 0) + Number(d.shifts));
        else dutyByManager.set(id, (dutyByManager.get(id) ?? 0) + Number(d.shifts));
    }

    return buildPeriodMetrics({ year: YEAR, month: MONTH, rows, clientDeals, incomingByManager, qualityByManager, scriptByManager, fastContactByManager, fieldsByManager, dutyByManager, workedDaysByManager, config });
}

/** Масштабирует метрики менеджера по фактору s (рост объёма при том же среднем чеке/миксе). */
function scaleMetrics(m: ManagerMetrics, s: number): ManagerMetrics {
    const baseRev = m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0);
    const baseN = m.countedOrders.length;
    const N2 = Math.max(0, Math.round(baseN * s));
    const avg = N2 > 0 ? (baseRev * s) / N2 : 0;
    const sameDayBase = m.countedOrders.filter((o) => o.createdAt && o.enteredAt && String(o.createdAt).slice(0, 10) === String(o.enteredAt).slice(0, 10)).length;
    const sameDayShare = baseN > 0 ? sameDayBase / baseN : 0;
    const sameDay2 = Math.round(sameDayShare * N2);
    const orders: CountedOrder[] = Array.from({ length: N2 }, (_, i) => ({
        orderId: -(i + 1), managerId: m.managerId, clientId: null, clientName: null, deals: 0,
        type: 'new', category: null, enteredAt: '2026-05-15', createdAt: i < sameDay2 ? '2026-05-15' : '2026-05-10',
        totalsumm: avg, goodsBase: avg, discountAmount: 0, discountPct: 0, revenueNoVat: avg, margin: 0,
    }));
    const scaleCounts = (rec: Record<string, number>, mult: number, round: boolean) => {
        const out: Record<string, number> = {};
        for (const k of Object.keys(rec)) out[k] = round ? Math.round(rec[k] * mult) : rec[k] * mult;
        return out;
    };
    return {
        ...m,
        countedOrders: orders,
        countsByType: { new: Math.round(m.countsByType.new * s), permanent: Math.round(m.countsByType.permanent * s) },
        countsByCategory: scaleCounts(m.countsByCategory, s, true),
        revenueByCategory: scaleCounts(m.revenueByCategory, s, false),
        conversion: { ...m.conversion, numerator: N2, denominator: Math.round(m.conversion.denominator * s), eligible: Math.round(m.conversion.denominator * s) >= 10 },
        dutyShifts: m.dutyShifts, // дежурства не масштабируются выручкой
        workedDays: null,
    };
}

async function main() {
    const config = await resolveConfig(ASOF);
    const blocks = await loadBlocks(SCHEME, ASOF);
    const metrics = await collectRealMetrics(config);
    const businessDays = businessDaysInMonth(YEAR, MONTH);

    // грейды
    const gradeRows = await sql`select distinct on (manager_id) manager_id, grade_level from salary_grade where effective_from <= ${ASOF} order by manager_id, effective_from desc`;
    const gradeByManager = new Map<number, number>();
    for (const r of gradeRows) gradeByManager.set(Number(r.manager_id), Number(r.grade_level));

    // менеджеры схемы (реестр menedzhery)
    const compRows = await sql`select manager_id from salary_manager_comp where scheme_code = ${SCHEME} and effective_from <= ${ASOF}`;
    const managerIds = compRows.map((r) => Number(r.manager_id));
    const names = await sql`select id, first_name, last_name from managers where id in ${sql(managerIds)}`;
    const nameById = new Map<number, string>();
    for (const n of names) nameById.set(Number(n.id), [n.last_name, n.first_name].filter(Boolean).join(' ') || `ID ${n.id}`);

    const metricsById = new Map(metrics.managers.map((m) => [m.managerId, m]));
    const baseTeamRev = metrics.teamRevenueNoVat;

    // факт из salary_calc для сверки
    const calcRows = await sql`select c.manager_id, c.total from salary_calc c join salary_period p on p.id=c.period_id where p.year=${YEAR} and p.month=${MONTH}`;
    const actualById = new Map<number, number>();
    for (const r of calcRows) actualById.set(Number(r.manager_id), Number(r.total));

    // планы (личные + отдела) для гейта
    const planRows = await sql`select manager_id, target from salary_plan where year=${YEAR} and month=${MONTH} and metric='revenue_no_vat'`;
    const personalPlan = new Map<number, number>();
    let deptPlan: number | null = null;
    for (const r of planRows) { if (r.manager_id == null) deptPlan = Number(r.target); else personalPlan.set(Number(r.manager_id), Number(r.target)); }

    // ── BASELINE: реальный расчёт по текущим правилам (с планами) ──
    const baseline: any[] = [];
    for (const id of managerIds) {
        const m = metricsById.get(id);
        if (!m) continue;
        const ctx = { year: YEAR, month: MONTH, businessDays, teamRevenueNoVat: baseTeamRev, personalPlanTarget: personalPlan.get(id) ?? null, departmentPlanTarget: deptPlan, managerGrade: gradeByManager.get(id) ?? null, categoryNames: {} };
        const res = computeManagerSalary(m, blocks, ctx as any, SCHEME);
        const pr = Math.round(m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0));
        baseline.push({
            id, name: nameById.get(id), personalRev: pr, orders: m.countedOrders.length,
            planAtt: personalPlan.get(id) ? Math.round((pr / personalPlan.get(id)!) * 100) : null,
            computed: res.total, actual: actualById.get(id) ?? null,
        });
    }

    // ── 2D-СЕТКА: план отдела × выполнение плана ──
    // Допущение: выручка и личный план распределяются по реальным долям менеджеров,
    // значит «выполнение» одинаково по всем (R/P=a), гейт по плану срабатывает единообразно на 90%.
    const shareById = new Map<number, number>();
    for (const id of managerIds) {
        const m = metricsById.get(id);
        const rev = m ? m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0) : 0;
        shareById.set(id, baseTeamRev > 0 ? rev / baseTeamRev : 0);
    }

    const cells: any[] = [];
    for (const P of PLAN_GRID) {
        for (const a of ATTAIN_GRID) {
            const R = P * (a / 100); // выручка отдела
            const s = baseTeamRev > 0 ? R / baseTeamRev : 1; // объём масштабируется выручкой
            const perManager: any[] = [];
            let total = 0;
            for (const id of managerIds) {
                const m = metricsById.get(id);
                if (!m) continue;
                const sm = scaleMetrics(m, s);
                const share = shareById.get(id) ?? 0;
                // -0.01 ₽ снимает float-неоднозначность сравнения «ровно на пороге»: att=90% должен проходить гейт (правило «≥ порога»)
                const ctx = { year: YEAR, month: MONTH, businessDays, teamRevenueNoVat: R, personalPlanTarget: P * share - 0.01, departmentPlanTarget: P, managerGrade: gradeByManager.get(id) ?? null, categoryNames: {} };
                const res = computeManagerSalary(sm, blocks, ctx as any, SCHEME);
                perManager.push({ id, name: nameById.get(id), total: res.total, kTeam: res.kTeam });
                total += res.total;
            }
            cells.push({ plan: P, attain: a, revenue: Math.round(R), total: Math.round(total), costPct: R > 0 ? Number((total / R * 100).toFixed(2)) : 0, kTeam: perManager[0]?.kTeam ?? 1, perManager });
        }
    }

    const out = { year: YEAR, month: MONTH, scheme: SCHEME, baseTeamRev: Math.round(baseTeamRev), planGrid: PLAN_GRID, attainGrid: ATTAIN_GRID, cells, shares: Object.fromEntries(Array.from(shareById).map(([k, v]) => [k, Number(v.toFixed(3))])), names: Object.fromEntries(nameById), kTeamTiers: (blocks.find((b) => b.code === 'k_team')?.params as any)?.tiers };
    writeFileSync('scratch/plan_grid_output.json', JSON.stringify(out, null, 2));
    console.log('baseTeamRev:', Math.round(baseTeamRev));
    console.log('BASELINE check:');
    for (const b of baseline) console.log(`  ${b.name}: computed=${b.computed} actual=${b.actual}`);
    console.log('\nФОТ отдела (строки=план млн, столбцы=выполнение %):');
    const hdr = 'план\\вып ' + ATTAIN_GRID.map((a) => String(a).padStart(8)).join('');
    console.log(hdr);
    for (const P of PLAN_GRID) {
        const row = ATTAIN_GRID.map((a) => {
            const c = cells.find((x) => x.plan === P && x.attain === a)!;
            return String(Math.round(c.total / 1000) + 'к').padStart(8);
        }).join('');
        console.log(String((P / 1e6).toFixed(0) + 'M').padStart(8) + ' ' + row);
    }
    // ── Кросс-чек: client-путь computeScenarioFot должен совпасть с движком ──
    const simBases = managerIds.map((id) => {
        const m = metricsById.get(id)!;
        const b = toSimBase(m, shareById.get(id) ?? 0, gradeByManager.get(id) ?? null, null);
        b.name = String(id);
        return b;
    });
    console.log('\nКРОСС-ЧЕК (движок vs client computeScenarioFot):');
    for (const [P, a] of [[12e6, 100], [20e6, 100], [16e6, 90], [10e6, 80]] as [number, number][]) {
        const R = P * (a / 100);
        const engineCell = cells.find((c) => c.plan === P && c.attain === a)!.total;
        const sim = computeScenarioFot(blocks, simBases, { teamRevenue: R, deptPlan: P, businessDays, year: YEAR, month: MONTH, baseTeamRevenue: baseTeamRev });
        const ok = Math.abs(sim.total - engineCell) < 1 ? 'OK' : 'MISMATCH';
        console.log(`  план ${(P / 1e6)}M вып ${a}%: движок=${engineCell} client=${sim.total} → ${ok}`);
    }

    console.log('\n→ scratch/plan_grid_output.json');
    await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
