'use client';

// Интерактивный симулятор ФОТ. Открывается из карточки роли. Один раз грузит
// реальный срез метрик baseline-месяца, дальше ВСЁ считается мгновенно в браузере
// тем же движком (computeScenarioFot → чистый compose). Ползунки параметров
// генерируются автоматически из блоков схемы: добавили блок — появились его ползунки.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Loader2, RotateCcw, FlaskConical } from 'lucide-react';
import { formatNumberRu } from '@/lib/format';
import { computeScenarioFot, type SimManagerBase } from '@/lib/salary/sim-shared';
import type { BlockInstance } from '@/lib/salary/blocks/types';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type SchemeBlockLite = { block_code: string; params: any; enabled?: boolean };
type Props = {
    schemeCode: string;
    schemeName: string;
    blocks: SchemeBlockLite[];
    managerIds: number[];
    initialYear: number;
    initialMonth: number;
    onClose: () => void;
};

// ── Диапазоны ползунков по смыслу параметра (ключ + код блока + контекст строки) ──
type Range = { min: number; max: number; step: number; unit: '₽' | '%' | '×' | 'шт' };
function rangeFor(blockCode: string, key: string, rowMode?: string): Range | null {
    switch (key) {
        case 'oklad': return { min: 0, max: 150000, step: 1000, unit: '₽' };
        case 'new': case 'permanent': return { min: 0, max: 10000, step: 100, unit: '₽' };
        case 'rate': return { min: 0, max: 5000, step: 50, unit: '₽' };
        case 'perPercent': return { min: 0, max: 5000, step: 50, unit: '₽' };
        case 'bonus': return { min: 0, max: 30000, step: 500, unit: '₽' };
        case 'minZayavki': return { min: 0, max: 50, step: 1, unit: 'шт' };
        case 'threshold': return { min: 0, max: 50, step: 1, unit: '%' };
        case 'thresholdPct': return { min: 0, max: 100, step: 1, unit: '%' };
        case 'k': case 'coef': return { min: 0.5, max: 2, step: 0.05, unit: '×' };
        case 'min': return blockCode === 'k_team'
            ? { min: 0, max: 40_000_000, step: 500_000, unit: '₽' }
            : { min: 0, max: 100, step: 1, unit: '%' }; // conv_bonus: порог конверсии
        case 'value': return rowMode === 'pct' ? { min: 0, max: 50, step: 0.5, unit: '%' } : { min: 0, max: 30000, step: 500, unit: '₽' };
        case 'level': case 'prorate': return null; // не ползунки
        default: return { min: 0, max: 100000, step: 1000, unit: '₽' };
    }
}

// Человеческая подпись ползунка с контекстом тира.
function ctrlLabel(blockCode: string, key: string, item?: any): string {
    if (key === 'oklad') return 'Оклад';
    if (key === 'new') return 'Ставка за новую заявку';
    if (key === 'permanent') return 'Ставка за постоянного';
    if (key === 'rate') return blockCode === 'duty' ? 'Ставка за смену' : 'Ставка за заказ';
    if (key === 'perPercent') return 'Ставка за 1% сверх плана';
    if (key === 'minZayavki') return 'Мин. входящих для допуска';
    if (key === 'thresholdPct') return 'Порог выполнения плана';
    if (key === 'threshold') return 'Порог метрики';
    if (key === 'bonus') return item && item.min != null ? `Бонус при ≥ ${item.min}%` : 'Бонус';
    if (key === 'k') {
        if (blockCode === 'k_team' && item?.min != null) return `× при выручке ≥ ${formatNumberRu(item.min)} ₽`;
        if (item?.level != null) return `× для грейда ${item.level}`;
        return 'Коэффициент';
    }
    if (key === 'coef') return 'Коэффициент категории';
    if (key === 'value') return item?.mode === 'pct' ? '% от продажи' : 'Доплата за заявку';
    if (key === 'min') return blockCode === 'k_team' ? 'Порог выручки' : 'Порог конверсии';
    return key;
}

// Развернуть параметры блока в плоский список ползунков с путём к значению.
type Control = { path: (string | number)[]; label: string; range: Range; value: number };
function controlsForBlock(blockCode: string, params: any): Control[] {
    const out: Control[] = [];
    const walk = (val: any, path: (string | number)[], rowMode?: string) => {
        if (val == null) return;
        if (typeof val === 'number') {
            const key = String(path[path.length - 1]);
            const r = rangeFor(blockCode, key, rowMode);
            if (r) out.push({ path, label: '', range: r, value: val });
            return;
        }
        if (Array.isArray(val)) {
            val.forEach((item, i) => walk(item, [...path, i], item?.mode));
            return;
        }
        if (typeof val === 'object') {
            for (const k of Object.keys(val)) walk(val[k], [...path, k], val.mode);
        }
    };
    walk(params, []);
    // подписи с контекстом тира/строки
    for (const c of out) {
        const key = String(c.path[c.path.length - 1]);
        let item: any = params;
        for (let i = 0; i < c.path.length - 1; i++) item = item?.[c.path[i] as any];
        c.label = ctrlLabel(blockCode, key, item);
    }
    return out;
}

function setAtPath(obj: any, path: (string | number)[], value: number): any {
    if (!path.length) return value;
    const [head, ...rest] = path;
    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
    clone[head as any] = setAtPath(obj?.[head as any], rest, value);
    return clone;
}

const BLOCK_NAMES: Record<string, string> = {
    oklad: 'Оклад', premia_zayavki: 'Премия за заявки', premia_categorii: 'Премия за категории',
    coef_categorii: 'Коэффициент за категории', k_quality: 'К_качества', conv_bonus: 'Конв-бонус',
    discount_bonus: 'Скидочная дисциплина', k_team: 'К_команды', duty: 'Дежурства',
    plan_attainment: 'Выполнение плана', plan_accelerator: 'Ускоритель плана', plan_gate: 'Гейт по плану',
    department_plan_gate: 'Гейт по плану отдела', volume_bonus: 'Бонус за объём', same_day_sale: 'Продажа в день обращения',
    script_bonus: 'Соблюдение скрипта', fast_contact_bonus: 'Скорость контакта', fields_bonus: 'Заполнение ТЗ',
    grade_multiplier: 'Грейд-коэффициент',
};

export default function FotSimulatorModal({ schemeCode, schemeName, blocks: initialBlocks, managerIds, initialYear, initialMonth, onClose }: Props) {
    const [year, setYear] = useState(initialYear);
    const [month, setMonth] = useState(initialMonth);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [bases, setBases] = useState<SimManagerBase[]>([]);
    const [baseTeamRev, setBaseTeamRev] = useState(0);
    const [businessDays, setBusinessDays] = useState(21);
    // редактируемый черновик блоков (песочница, не сохраняется)
    const [blocks, setBlocks] = useState<SchemeBlockLite[]>(() => initialBlocks.map((b) => ({ ...b, params: structuredClone(b.params ?? {}) })));
    const [teamRevenue, setTeamRevenue] = useState(0);
    const [deptPlan, setDeptPlan] = useState(0);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(`/api/salary/sim-baseline?year=${year}&month=${month}&ids=${managerIds.join(',')}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка загрузки');
            setBases(j.managers ?? []);
            setBaseTeamRev(j.baseTeamRev ?? 0);
            setBusinessDays(j.businessDays ?? 21);
            setTeamRevenue(j.baseTeamRev || 12_000_000);
            setDeptPlan(j.deptPlan || j.baseTeamRev || 12_000_000);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, [year, month, managerIds]);
    useEffect(() => { load(); }, [load]);

    const enabledBlocks: BlockInstance[] = useMemo(
        () => blocks.filter((b) => b.enabled !== false).map((b) => ({ code: b.block_code, params: b.params ?? {} })),
        [blocks],
    );

    const result = useMemo(() => {
        if (!bases.length) return { perManager: [], total: 0 };
        return computeScenarioFot(enabledBlocks, bases, { teamRevenue, deptPlan, businessDays, year, month, baseTeamRevenue: baseTeamRev });
    }, [enabledBlocks, bases, teamRevenue, deptPlan, businessDays, year, month, baseTeamRev]);

    // Кривая ФОТ по выручке (для графика) — пересчитывается при любой правке.
    const curve = useMemo(() => {
        if (!bases.length || !baseTeamRev) return [] as { rev: number; total: number }[];
        const maxR = Math.max(baseTeamRev * 2.6, deptPlan * 1.3, 26_000_000);
        const pts: { rev: number; total: number }[] = [];
        for (let i = 0; i <= 28; i++) {
            const rev = (maxR / 28) * i;
            const r = computeScenarioFot(enabledBlocks, bases, { teamRevenue: rev, deptPlan, businessDays, year, month, baseTeamRevenue: baseTeamRev });
            pts.push({ rev, total: r.total });
        }
        return pts;
    }, [enabledBlocks, bases, deptPlan, businessDays, year, month, baseTeamRev]);

    const setControl = (blockIdx: number, path: (string | number)[], value: number) =>
        setBlocks((prev) => prev.map((b, i) => (i === blockIdx ? { ...b, params: setAtPath(b.params, path, value) } : b)));

    const reset = () => setBlocks(initialBlocks.map((b) => ({ ...b, params: structuredClone(b.params ?? {}) })));

    const attainment = deptPlan > 0 ? (teamRevenue / deptPlan) * 100 : 0;
    const costPct = teamRevenue > 0 ? (result.total / teamRevenue) * 100 : 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col bg-white" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 border-b bg-violet-100/60 px-3 py-2">
                    <FlaskConical className="h-4 w-4 text-violet-700" />
                    <span className="text-sm font-semibold text-violet-900">Симулятор ФОТ · {schemeName}</span>
                    <span className="bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-violet-800">не сохраняется</span>
                    <label className="ml-auto text-[11px] text-muted-foreground">данные за</label>
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-7 border px-1.5 text-xs">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-7 border px-1.5 text-xs">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={reset} title="Сбросить параметры" className="ml-1 inline-flex h-7 items-center gap-1 border px-2 text-xs hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" /> Сброс</button>
                    <button onClick={onClose} aria-label="Закрыть" className="inline-flex h-7 w-7 items-center justify-center border hover:bg-muted"><X className="h-4 w-4" /></button>
                </div>

                {loading ? (
                    <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : error ? (
                    <div className="p-6 text-sm text-red-600">{error}</div>
                ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] overflow-hidden">
                        {/* Левая колонка: ползунки */}
                        <div className="overflow-y-auto border-r p-3">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground">Сценарий</div>
                            <Slider label="Выручка отдела" unit="₽" min={0} max={Math.max(baseTeamRev * 2.6, 30_000_000)} step={250_000} value={teamRevenue} onChange={setTeamRevenue} />
                            <Slider label="План отдела" unit="₽" min={0} max={Math.max(baseTeamRev * 2.2, 24_000_000)} step={250_000} value={deptPlan} onChange={setDeptPlan} />
                            <div className="mb-3 mt-1 flex gap-3 text-[11px] text-muted-foreground">
                                <span>Выполнение: <b className={attainment >= 90 ? 'text-emerald-700' : 'text-red-600'}>{Math.round(attainment)}%</b></span>
                                <span>ФОТ/выручка: <b>{costPct.toFixed(2)}%</b></span>
                            </div>

                            {blocks.filter((b) => b.enabled !== false).map((b) => {
                                const realIdx = blocks.indexOf(b);
                                const controls = controlsForBlock(b.block_code, b.params ?? {});
                                if (!controls.length) return null;
                                return (
                                    <div key={b.block_code} className="mb-2 border-t pt-2">
                                        <div className="mb-1 text-[11px] font-semibold">{BLOCK_NAMES[b.block_code] ?? b.block_code}</div>
                                        {controls.map((c, ci) => (
                                            <Slider key={ci} label={c.label} unit={c.range.unit} min={c.range.min} max={c.range.max} step={c.range.step} value={c.value}
                                                onChange={(v) => setControl(realIdx, c.path, v)} />
                                        ))}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Правая колонка: результат + график + по менеджерам */}
                        <div className="overflow-y-auto p-4">
                            <div className="flex items-end gap-6">
                                <div>
                                    <div className="text-[11px] uppercase tracking-tight text-muted-foreground">ФОТ отдела ({result.perManager.length} чел.)</div>
                                    <div className="text-3xl font-semibold tabular-nums">{formatNumberRu(result.total)} ₽</div>
                                </div>
                                <div className="pb-1">
                                    <div className="text-[11px] text-muted-foreground">выручка {formatNumberRu(Math.round(teamRevenue))} ₽ · вып. {Math.round(attainment)}%</div>
                                    <div className="text-[11px] text-muted-foreground">доля ФОТ в выручке {costPct.toFixed(2)}%</div>
                                </div>
                            </div>

                            <FotChart curve={curve} current={teamRevenue} tiers={blocks.find((b) => b.block_code === 'k_team')?.params?.tiers} />

                            <div className="mt-4 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground">По менеджерам</div>
                            <div className="mt-1 divide-y border">
                                {result.perManager.map((p) => {
                                    const maxTotal = Math.max(...result.perManager.map((x) => x.total), 1);
                                    return (
                                        <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                            <span className="w-36 shrink-0 truncate">{p.name}</span>
                                            <div className="relative h-4 flex-1 bg-muted">
                                                <div className="absolute inset-y-0 left-0 bg-violet-400" style={{ width: `${(p.total / maxTotal) * 100}%` }} />
                                            </div>
                                            <span className="w-24 shrink-0 text-right tabular-nums">{formatNumberRu(p.total)} ₽</span>
                                            <span className={`w-12 shrink-0 text-right ${p.gatePass ? 'text-emerald-700' : 'text-red-600'}`}>{Math.round(p.attainmentPct)}%</span>
                                            <span className="w-10 shrink-0 text-right text-muted-foreground">×{p.kTeam}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
                                Объём (число заказов) масштабируется выручкой; средний чек, доли категорий и типов клиента, качество, конверсия — на уровне baseline-месяца. План отдела делится по реальным долям менеджеров → выполнение одинаково по всем. Расчёт идёт тем же движком, ничего не сохраняется.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Slider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
    const disp = unit === '×' ? '×' + value : unit === '%' ? value + '%' : unit === 'шт' ? value + ' шт' : formatNumberRu(Math.round(value)) + ' ₽';
    return (
        <div className="mb-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="text-[11px] font-semibold tabular-nums">{disp}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full cursor-pointer" />
        </div>
    );
}

function FotChart({ curve, current, tiers }: { curve: { rev: number; total: number }[]; current: number; tiers?: { min: number; k: number }[] }) {
    if (!curve.length) return null;
    const W = 600, H = 180, padL = 8, padR = 8, padT = 10, padB = 18;
    const maxRev = Math.max(...curve.map((p) => p.rev), 1);
    const maxTot = Math.max(...curve.map((p) => p.total), 1);
    const x = (rev: number) => padL + (rev / maxRev) * (W - padL - padR);
    const y = (t: number) => H - padB - (t / maxTot) * (H - padT - padB);
    const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.rev).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
    const curTotal = (() => {
        // линейная интерполяция ФОТ для текущей выручки
        for (let i = 1; i < curve.length; i++) {
            if (current <= curve[i].rev) {
                const a = curve[i - 1], b = curve[i];
                const t = (current - a.rev) / Math.max(1, b.rev - a.rev);
                return a.total + (b.total - a.total) * t;
            }
        }
        return curve[curve.length - 1].total;
    })();
    return (
        <div className="mt-3 border bg-white p-1">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Кривая ФОТ по выручке отдела">
                {(tiers ?? []).filter((tr) => tr.min > 0 && tr.min < maxRev).map((tr, i) => (
                    <g key={i}>
                        <line x1={x(tr.min)} x2={x(tr.min)} y1={padT} y2={H - padB} stroke="#ddd6fe" strokeWidth={1} strokeDasharray="3 3" />
                        <text x={x(tr.min) + 2} y={padT + 8} fontSize={8} fill="#7c3aed">×{tr.k}</text>
                    </g>
                ))}
                <path d={line} fill="none" stroke="#7c3aed" strokeWidth={2} />
                <line x1={x(current)} x2={x(current)} y1={padT} y2={H - padB} stroke="#16a34a" strokeWidth={1} />
                <circle cx={x(current)} cy={y(curTotal)} r={3.5} fill="#16a34a" />
            </svg>
            <div className="px-1 pb-0.5 text-[9px] text-muted-foreground">ось X — выручка отдела (0…{formatNumberRu(Math.round(maxRev))} ₽), линия — ФОТ; зелёная отметка — текущий сценарий</div>
        </div>
    );
}
