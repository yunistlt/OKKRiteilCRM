'use client';

// Персональный симулятор ЗП одного менеджера. Открывается из ведомости (/salary)
// и из «Моей зарплаты» (/salary/my). Грузит один раз реальный срез показателей
// baseline-месяца, дальше ВСЁ считается мгновенно в браузере тем же движком
// (computeManagerScenario → чистый compose).
//
// Роли:
//  • admin/rop (canEditParams=true) — крутят и ПОКАЗАТЕЛИ, и ПАРАМЕТРЫ схемы;
//  • manager (canEditParams=false) — крутят только свои ПОКАЗАТЕЛИ; параметры
//    схемы и контекст (план, выручка отдела) видны, но read-only.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Loader2, RotateCcw, FlaskConical, Lock } from 'lucide-react';
import { formatNumberRu } from '@/lib/format';
import {
    computeManagerScenario, inputsFromBase,
    type SimManagerBase, type SimManagerInputs,
} from '@/lib/salary/sim-shared';
import { BLOCK_NAMES, controlsForBlock, setAtPath, tintFor } from '@/lib/salary/sim-controls';
import type { BlockInstance } from '@/lib/salary/blocks/types';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type SchemeBlockLite = { block_code: string; params: any };
type Props = {
    managerId: number;
    managerName: string;
    canEditParams: boolean; // admin/rop — true; manager — false
    initialYear: number;
    initialMonth: number;
    onClose: () => void;
};

// ── Показатели (метрики) менеджера: какие ползунки показывать в зависимости от блоков схемы ──
type InputKey = keyof SimManagerInputs;
type InputDesc = {
    key: InputKey;
    label: string;
    blocks: string[]; // показатель релевантен, если в схеме есть хотя бы один из этих блоков
    min: number;
    maxOf: (b: SimManagerBase) => number; // верх ползунка зависит от baseline
    step: number;
    fmt: (v: number) => string;
};

const VOLUME_BLOCKS = ['premia_zayavki', 'premia_categorii', 'coef_categorii', 'conv_bonus', 'plan_attainment', 'plan_accelerator', 'plan_gate', 'department_plan_gate', 'plan_coef', 'dept_plan_coef', 'volume_bonus', 'same_day_sale', 'k_team'];
const REVENUE_BLOCKS = ['premia_categorii', 'plan_attainment', 'plan_accelerator', 'plan_gate', 'department_plan_gate', 'plan_coef', 'dept_plan_coef', 'volume_bonus', 'k_team'];

const rubFmt = (v: number) => formatNumberRu(Math.round(v)) + ' ₽';
const pctFmt = (v: number) => v + '%';
const shtFmt = (v: number) => v + ' шт';

const INPUT_DESCS: InputDesc[] = [
    { key: 'ordersNew', label: 'Новых заявок', blocks: VOLUME_BLOCKS, min: 0, maxOf: (b) => Math.max(50, Math.ceil(((b.countsByType?.new ?? 0) + 1) * 3)), step: 1, fmt: shtFmt },
    { key: 'ordersPermanent', label: 'Заявок постоянных', blocks: VOLUME_BLOCKS, min: 0, maxOf: (b) => Math.max(50, Math.ceil(((b.countsByType?.permanent ?? 0) + 1) * 3)), step: 1, fmt: shtFmt },
    { key: 'avgCheck', label: 'Средний чек', blocks: REVENUE_BLOCKS, min: 0, maxOf: (b) => Math.max(200_000, Math.ceil((b.baseOrders > 0 ? b.baseRevenue / b.baseOrders : 50_000) * 3)), step: 1000, fmt: rubFmt },
    { key: 'conversionPct', label: 'Конверсия', blocks: ['conv_bonus'], min: 0, maxOf: () => 100, step: 1, fmt: pctFmt },
    { key: 'incomingCount', label: 'Поступило заявок', blocks: ['conv_bonus'], min: 0, maxOf: (b) => Math.max(50, Math.ceil((b.conversionDenominator + 1) * 3)), step: 1, fmt: shtFmt },
    { key: 'sameDayShare', label: 'Доля «в день обращения»', blocks: ['same_day_sale'], min: 0, maxOf: () => 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'qualityAvgScore', label: 'Скоринг ОКК (балл)', blocks: ['k_quality'], min: 0, maxOf: () => 100, step: 1, fmt: (v) => String(Math.round(v)) },
    { key: 'qualityScriptPct', label: 'Соблюдение скрипта', blocks: ['script_bonus'], min: 0, maxOf: () => 100, step: 1, fmt: pctFmt },
    { key: 'fastContactShare', label: 'Скорость первого контакта', blocks: ['fast_contact_bonus'], min: 0, maxOf: () => 100, step: 1, fmt: pctFmt },
    { key: 'fieldsFilledShare', label: 'Заполнение ТЗ', blocks: ['fields_bonus'], min: 0, maxOf: () => 100, step: 1, fmt: pctFmt },
    { key: 'discountMetricValue', label: 'Скидочная дисциплина', blocks: ['discount_bonus'], min: 0, maxOf: () => 100, step: 0.5, fmt: pctFmt },
    { key: 'dutyShifts', label: 'Дежурства (смен)', blocks: ['duty'], min: 0, maxOf: () => 31, step: 1, fmt: shtFmt },
    { key: 'grade', label: 'Грейд', blocks: ['grade_multiplier'], min: 1, maxOf: () => 5, step: 1, fmt: (v) => 'грейд ' + Math.round(v) },
];

// Показатель → блок-«хозяин»: рядом с показателем показываем тариф этого же блока
// (визуальная группировка «показатель + его тариф» в одну карточку).
const INPUT_OWNER: Record<InputKey, string> = {
    ordersNew: 'premia_zayavki', ordersPermanent: 'premia_zayavki', avgCheck: 'premia_zayavki',
    conversionPct: 'conv_bonus', incomingCount: 'conv_bonus',
    sameDayShare: 'same_day_sale',
    qualityAvgScore: 'k_quality', qualityScriptPct: 'script_bonus',
    fastContactShare: 'fast_contact_bonus', fieldsFilledShare: 'fields_bonus',
    discountMetricValue: 'discount_bonus', dutyShifts: 'duty', grade: 'grade_multiplier',
};

const PLAN_BLOCKS = ['plan_attainment', 'plan_accelerator', 'plan_gate', 'plan_coef'];
const DEPT_PLAN_BLOCKS = ['department_plan_gate', 'dept_plan_coef'];

export default function ManagerSalarySimulatorModal({ managerId, managerName, canEditParams, initialYear, initialMonth, onClose }: Props) {
    const [year, setYear] = useState(initialYear);
    const [month, setMonth] = useState(initialMonth);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [base, setBase] = useState<SimManagerBase | null>(null);
    const [businessDays, setBusinessDays] = useState(21);
    const [baseTeamRev, setBaseTeamRev] = useState(0);
    const [schemeCode, setSchemeCode] = useState('');

    const [inputs, setInputs] = useState<SimManagerInputs | null>(null);
    const [blocks, setBlocks] = useState<SchemeBlockLite[]>([]); // черновик параметров схемы
    const [teamRevenue, setTeamRevenue] = useState(0);
    const [personalPlan, setPersonalPlan] = useState(0);
    const [deptPlan, setDeptPlan] = useState(0);
    const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
    // дефолты для кнопки «Сброс»
    const [defaults, setDefaults] = useState<{ inputs: SimManagerInputs; blocks: SchemeBlockLite[]; teamRevenue: number; personalPlan: number; deptPlan: number } | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(`/api/salary/sim-manager?year=${year}&month=${month}&id=${managerId}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка загрузки');
            const b: SimManagerBase = j.base;
            const inp = inputsFromBase(b);
            const blk: SchemeBlockLite[] = (j.blocks ?? []).map((x: any) => ({ block_code: x.block_code, params: structuredClone(x.params ?? {}) }));
            const tRev = j.baseTeamRev || 0;
            const pPlan = j.personalPlan || 0;
            const dPlan = j.deptPlan || 0;
            setBase(b); setBusinessDays(j.businessDays ?? 21); setBaseTeamRev(tRev); setSchemeCode(j.schemeCode ?? '');
            setCategoryNames(j.categoryNames ?? {});
            setInputs(inp); setBlocks(blk); setTeamRevenue(tRev); setPersonalPlan(pPlan); setDeptPlan(dPlan);
            setDefaults({ inputs: inp, blocks: blk.map((x) => ({ ...x, params: structuredClone(x.params) })), teamRevenue: tRev, personalPlan: pPlan, deptPlan: dPlan });
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, [year, month, managerId]);
    useEffect(() => { load(); }, [load]);

    const blockCodes = useMemo(() => blocks.map((b) => b.block_code), [blocks]);
    const enabledBlocks: BlockInstance[] = useMemo(() => blocks.map((b) => ({ code: b.block_code, params: b.params ?? {} })), [blocks]);

    const scenario = useMemo(() => ({ teamRevenue, personalPlan, deptPlan, businessDays, year, month, categoryNames }), [teamRevenue, personalPlan, deptPlan, businessDays, year, month, categoryNames]);

    const result = useMemo(() => {
        if (!base || !inputs) return null;
        return computeManagerScenario(enabledBlocks, base, inputs, scenario);
    }, [enabledBlocks, base, inputs, scenario]);

    // Кривая ЗП по числу заказов (сохраняя долю новых/постоянных).
    const curve = useMemo(() => {
        if (!base || !inputs) return [] as { orders: number; total: number }[];
        const cur = inputs.ordersNew + inputs.ordersPermanent;
        const maxOrders = Math.max(30, Math.ceil(cur * 2.5));
        const newShare = cur > 0 ? inputs.ordersNew / cur : 0.5;
        const pts: { orders: number; total: number }[] = [];
        for (let i = 0; i <= 28; i++) {
            const n = Math.round((maxOrders / 28) * i);
            const inp2 = { ...inputs, ordersNew: Math.round(n * newShare), ordersPermanent: n - Math.round(n * newShare) };
            const r = computeManagerScenario(enabledBlocks, base, inp2, scenario);
            pts.push({ orders: n, total: r.total });
        }
        return pts;
    }, [enabledBlocks, base, inputs, scenario]);

    const setInput = (key: InputKey, value: number) => setInputs((prev) => (prev ? { ...prev, [key]: value } : prev));
    const setParam = (blockIdx: number, path: (string | number)[], value: number) =>
        setBlocks((prev) => prev.map((b, i) => (i === blockIdx ? { ...b, params: setAtPath(b.params, path, value) } : b)));

    const reset = () => {
        if (!defaults) return;
        setInputs(defaults.inputs);
        setBlocks(defaults.blocks.map((x) => ({ ...x, params: structuredClone(x.params) })));
        setTeamRevenue(defaults.teamRevenue); setPersonalPlan(defaults.personalPlan); setDeptPlan(defaults.deptPlan);
    };

    const hasAny = (codes: string[]) => codes.some((c) => blockCodes.includes(c));
    const curOrders = (inputs?.ordersNew ?? 0) + (inputs?.ordersPermanent ?? 0);
    const attainment = result?.attainmentPct ?? 0;

    // показатели, релевантные схеме (значение != null или блок-условие истинно)
    const shownInputs = INPUT_DESCS.filter((d) => hasAny(d.blocks) && (inputs ? inputs[d.key] != null : true));

    // Контекст-ползунки (выручка отдела / планы), привязанные к блоку-«хозяину».
    const planOwner = PLAN_BLOCKS.find((c) => blockCodes.includes(c));
    const deptOwner = DEPT_PLAN_BLOCKS.find((c) => blockCodes.includes(c));
    type Ctx = { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void };
    const contextFor = (code: string): Ctx[] => {
        const arr: Ctx[] = [];
        if (code === 'k_team') arr.push({ label: 'Выручка отдела (для К_команды)', min: 0, max: Math.max(baseTeamRev * 2.6, 30_000_000), step: 250_000, value: teamRevenue, onChange: setTeamRevenue });
        if (code === planOwner) arr.push({ label: 'Личный план', min: 0, max: Math.max(personalPlan * 2.6, 5_000_000), step: 100_000, value: personalPlan, onChange: setPersonalPlan });
        if (code === deptOwner) arr.push({ label: 'План отдела', min: 0, max: Math.max(deptPlan * 2.2, 24_000_000), step: 250_000, value: deptPlan, onChange: setDeptPlan });
        return arr;
    };

    // Группировка показателей по блоку-«хозяину»; «сироты» (хозяин не в схеме) — в общую карточку.
    const inputsByOwner = new Map<string, InputDesc[]>();
    const orphanInputs: InputDesc[] = [];
    for (const d of shownInputs) {
        const owner = INPUT_OWNER[d.key];
        if (owner && blockCodes.includes(owner)) inputsByOwner.set(owner, [...(inputsByOwner.get(owner) ?? []), d]);
        else orphanInputs.push(d);
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col bg-white" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 border-b bg-violet-100/60 px-3 py-2">
                    <FlaskConical className="h-4 w-4 text-violet-700" />
                    <span className="truncate text-sm font-semibold text-violet-900">Симулятор ЗП · {managerName}</span>
                    <span className="bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-violet-800">не сохраняется</span>
                    <label className="ml-auto text-[11px] text-muted-foreground">данные за</label>
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-7 border px-1.5 text-xs">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-7 border px-1.5 text-xs">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={reset} title="Сбросить к факту месяца" className="ml-1 inline-flex h-7 items-center gap-1 border px-2 text-xs hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" /> Сброс</button>
                    <button onClick={onClose} aria-label="Закрыть" className="inline-flex h-7 w-7 items-center justify-center border hover:bg-muted"><X className="h-4 w-4" /></button>
                </div>

                {loading ? (
                    <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : error ? (
                    <div className="p-6 text-sm text-red-600">{error}</div>
                ) : !base || !inputs || !result ? (
                    <div className="p-6 text-sm text-muted-foreground">Нет данных.</div>
                ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden">
                        {/* Левая колонка: карточки «показатель + его тариф» по блокам схемы */}
                        <div className="overflow-y-auto bg-muted/20 p-2 border-r">
                            {!canEditParams && (
                                <div className="mb-2 flex items-center gap-1.5 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700">
                                    <Lock className="h-3 w-3 shrink-0" /> Тарифы, ставки и пороги задаёт руководитель — здесь они только для справки.
                                </div>
                            )}

                            {/* Прочие показатели, чей блок-хозяин не в схеме */}
                            {orphanInputs.length > 0 && (
                                <div className="mb-2 border bg-white">
                                    <div className="border-b bg-muted/40 px-2 py-1 text-[11px] font-semibold">Показатели</div>
                                    <div className="p-2">
                                        {orphanInputs.map((d) => (
                                            <Slider key={d.key} label={d.label} min={d.min} max={d.maxOf(base)} step={d.step}
                                                value={Number(inputs[d.key] ?? 0)} fmt={d.fmt} onChange={(v) => setInput(d.key, v)} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* По одной карточке на блок схемы: сверху его показатели, ниже его тариф */}
                            {blocks.map((b) => {
                                const realIdx = blocks.indexOf(b);
                                const ins = inputsByOwner.get(b.block_code) ?? [];
                                const ctx = contextFor(b.block_code);
                                const controls = controlsForBlock(b.block_code, b.params ?? {}, categoryNames);
                                if (!ins.length && !ctx.length && !controls.length) return null;
                                const hasParams = ctx.length > 0 || controls.length > 0;
                                const tint = tintFor(b.block_code);
                                return (
                                    <div key={b.block_code} className="mb-2 border" style={{ backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` }}>
                                        <div className="flex items-center gap-1.5 border-b px-2 py-1 text-[11px] font-semibold">
                                            {BLOCK_NAMES[b.block_code] ?? b.block_code}
                                        </div>
                                        <div className="p-2">
                                            {/* Показатели — редактируются всегда */}
                                            {ins.map((d) => (
                                                <Slider key={d.key} label={d.label} min={d.min} max={d.maxOf(base)} step={d.step}
                                                    value={Number(inputs[d.key] ?? 0)} fmt={d.fmt} onChange={(v) => setInput(d.key, v)} />
                                            ))}
                                            {/* Тариф/параметры блока — admin/rop редактируют, менеджеру read-only */}
                                            {hasParams && (
                                                <div className={ins.length ? 'mt-2 border-t pt-2' : ''}>
                                                    {ins.length > 0 && (
                                                        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-tight text-muted-foreground">
                                                            Тариф {!canEditParams && <Lock className="h-2.5 w-2.5" />}
                                                        </div>
                                                    )}
                                                    {ctx.map((c, ci) => (
                                                        <Slider key={'ctx' + ci} label={c.label} min={c.min} max={c.max} step={c.step}
                                                            value={c.value} fmt={rubFmt} disabled={!canEditParams} onChange={c.onChange} />
                                                    ))}
                                                    {controls.map((c, ci) => (
                                                        <Slider key={'p' + ci} label={c.label} min={c.range.min} max={c.range.max} step={c.range.step}
                                                            value={c.value} fmt={fmtUnit(c.range.unit)} disabled={!canEditParams}
                                                            onChange={(v) => setParam(realIdx, c.path, v)} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Правая колонка: результат + разбивка + график */}
                        <div className="overflow-y-auto p-4">
                            <div className="flex items-end gap-6">
                                <div>
                                    <div className="text-[11px] uppercase tracking-tight text-muted-foreground">Итого к выплате</div>
                                    <div className="text-3xl font-semibold tabular-nums">{formatNumberRu(result.total)} ₽</div>
                                </div>
                                <div className="pb-1 text-[11px] text-muted-foreground">
                                    <div>заказов {curOrders} · выручка {formatNumberRu(Math.round(result.personalRev))} ₽</div>
                                    {personalPlan > 0 && <div>выполнение плана <b className={attainment >= 100 ? 'text-emerald-700' : 'text-red-600'}>{Math.round(attainment)}%</b> · К_команды ×{result.kTeam}</div>}
                                </div>
                            </div>

                            <ManagerChart curve={curve} current={curOrders} />

                            <div className="mt-4 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground">Как сложилась сумма</div>
                            <div className="mt-1 divide-y border text-xs">
                                {result.contributions.map((c, i) => (
                                    <div key={i} className="flex items-baseline justify-between gap-3 px-2 py-1">
                                        <div className="min-w-0">
                                            <span className="font-medium">{c.name}</span>
                                            {c.explain && <span className="ml-2 text-muted-foreground">{c.explain}</span>}
                                        </div>
                                        <div className="shrink-0 whitespace-nowrap font-medium tabular-nums">
                                            {c.kind === 'multiplier' ? `×${c.multiplier ?? 1}` : `${formatNumberRu(Math.round(c.amount || 0))} ₽`}
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-baseline justify-between gap-3 bg-muted/30 px-2 py-1.5 font-semibold">
                                    <span>Итого</span>
                                    <span className="tabular-nums">{formatNumberRu(result.total)} ₽</span>
                                </div>
                            </div>

                            <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
                                Показатели — это объём и качество работы менеджера за месяц; крутите их, чтобы увидеть, как меняется ЗП.
                                Средний чек, доли категорий и типов клиента берутся пропорционально числу заказов. Расчёт идёт тем же
                                движком, что и боевая ведомость, ничего не сохраняется.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function fmtUnit(unit: '₽' | '%' | '×' | 'шт') {
    return (v: number) => unit === '×' ? '×' + v : unit === '%' ? v + '%' : unit === 'шт' ? v + ' шт' : formatNumberRu(Math.round(v)) + ' ₽';
}

function Slider({ label, min, max, step, value, fmt, disabled, onChange }: { label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; disabled?: boolean; onChange: (v: number) => void }) {
    return (
        <div className="mb-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[11px] ${disabled ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>{label}</span>
                <span className={`text-[11px] font-semibold tabular-nums ${disabled ? 'text-muted-foreground/60' : ''}`}>{fmt(value)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`h-1 w-full ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} />
        </div>
    );
}

function ManagerChart({ curve, current }: { curve: { orders: number; total: number }[]; current: number }) {
    if (!curve.length) return null;
    const W = 600, H = 180, padL = 8, padR = 8, padT = 10, padB = 18;
    const maxOrders = Math.max(...curve.map((p) => p.orders), 1);
    const maxTot = Math.max(...curve.map((p) => p.total), 1);
    const x = (o: number) => padL + (o / maxOrders) * (W - padL - padR);
    const y = (t: number) => H - padB - (t / maxTot) * (H - padT - padB);
    const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.orders).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
    const curTotal = (() => {
        for (let i = 1; i < curve.length; i++) {
            if (current <= curve[i].orders) {
                const a = curve[i - 1], b = curve[i];
                const t = (current - a.orders) / Math.max(1, b.orders - a.orders);
                return a.total + (b.total - a.total) * t;
            }
        }
        return curve[curve.length - 1].total;
    })();
    return (
        <div className="mt-3 border bg-white p-1">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Кривая ЗП по числу заказов">
                <path d={line} fill="none" stroke="#7c3aed" strokeWidth={2} />
                <line x1={x(current)} x2={x(current)} y1={padT} y2={H - padB} stroke="#16a34a" strokeWidth={1} />
                <circle cx={x(current)} cy={y(curTotal)} r={3.5} fill="#16a34a" />
            </svg>
            <div className="px-1 pb-0.5 text-[9px] text-muted-foreground">ось X — число засчитанных заказов (0…{maxOrders}), линия — ЗП; зелёная отметка — текущий сценарий</div>
        </div>
    );
}
