'use client';

// Симулятор ФОТ для роли инженера-расчётчика. Один раз грузит реальные заказы
// назначенных инженеров за baseline-месяц (сумма + время расчёта), дальше всё
// считается мгновенно в браузере тем же движком (compose). Ползунки параметров
// генерируются из блоков роли (controlsForBlock) — как у менеджерского симулятора,
// но сценарий инженера — его заказы, а не выручка отдела.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, RotateCcw, FlaskConical } from 'lucide-react';
import { formatNumberRu } from '@/lib/format';
import { compose } from '@/lib/salary/blocks/compose';
import { BLOCK_NAMES, controlsForBlock, setAtPath, tintFor } from '@/lib/salary/sim-controls';
import type { BlockComputeContext, BlockInstance } from '@/lib/salary/blocks/types';
import type { ManagerMetrics } from '@/lib/salary/metrics';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type SchemeBlockLite = { block_code: string; params: any; enabled?: boolean };
type EngBase = { itemCode: string; name: string; orders: { orderId: number; sum: number; raschetSeconds: number | null }[] };
type Props = {
    schemeName: string;
    blocks: SchemeBlockLite[];
    itemCodes: string[];
    initialYear: number;
    initialMonth: number;
    onClose: () => void;
};

// ManagerMetrics-обёртка инженера (пустые менеджерские поля + его заказы) — для compose.
function engMetrics(orders: EngBase['orders']): ManagerMetrics {
    return {
        managerId: 0, countedOrders: [], countsByType: { new: 0, permanent: 0 }, countsByCategory: {}, revenueByCategory: {},
        discountMetricValue: null, qualityAvgScore: null, qualityScriptPct: null, fastContactShare: null, fieldsFilledShare: null,
        conversion: { numerator: 0, denominator: 0, pct: 0, eligible: false }, workedDays: null, marginTotal: 0,
        engineerOrders: orders.map((o) => ({ orderId: o.orderId, orderSum: o.sum, raschetSeconds: o.raschetSeconds, enteredAt: '' })),
    };
}

export default function EngineerFotSimulatorModal({ schemeName, blocks: initialBlocks, itemCodes, initialYear, initialMonth, onClose }: Props) {
    const [year, setYear] = useState(initialYear);
    const [month, setMonth] = useState(initialMonth);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [bases, setBases] = useState<EngBase[]>([]);
    const [businessDays, setBusinessDays] = useState(21);
    const [blocks, setBlocks] = useState<SchemeBlockLite[]>(() => initialBlocks.map((b) => ({ ...b, params: structuredClone(b.params ?? {}) })));

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(`/api/salary/sim-engineer-baseline?year=${year}&month=${month}&codes=${itemCodes.map(encodeURIComponent).join(',')}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка загрузки');
            setBases(j.engineers ?? []);
            setBusinessDays(j.businessDays ?? 21);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, [year, month, itemCodes]);
    useEffect(() => { load(); }, [load]);

    const enabledBlocks: BlockInstance[] = useMemo(
        () => blocks.filter((b) => b.enabled !== false).map((b) => ({ code: b.block_code, params: b.params ?? {} })),
        [blocks],
    );

    const result = useMemo(() => {
        const ctx: BlockComputeContext = { year, month, businessDays, teamRevenueNoVat: 0, personalPlanTarget: null, departmentPlanTarget: null, managerGrade: null, categoryNames: {} };
        const per = bases.map((e) => ({ itemCode: e.itemCode, name: e.name, orders: e.orders.length, total: compose(enabledBlocks, engMetrics(e.orders), ctx).total }));
        return { per, total: per.reduce((s, p) => s + p.total, 0) };
    }, [enabledBlocks, bases, businessDays, year, month]);

    const setControl = (blockIdx: number, path: (string | number)[], value: number) =>
        setBlocks((prev) => prev.map((b, i) => (i === blockIdx ? { ...b, params: setAtPath(b.params, path, value) } : b)));
    const reset = () => setBlocks(initialBlocks.map((b) => ({ ...b, params: structuredClone(b.params ?? {}) })));

    const totalOrders = bases.reduce((s, e) => s + e.orders.length, 0);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col bg-white" onClick={(e) => e.stopPropagation()}>
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
                        {/* Ползунки параметров роли */}
                        <div className="overflow-y-auto border-r bg-muted/20 p-2">
                            {blocks.filter((b) => b.enabled !== false).map((b) => {
                                const realIdx = blocks.indexOf(b);
                                const controls = controlsForBlock(b.block_code, b.params ?? {});
                                if (!controls.length) return null;
                                const tint = tintFor(b.block_code);
                                return (
                                    <div key={b.block_code} className="mb-2 border" style={{ backgroundColor: tint.bg, borderLeft: `3px solid ${tint.bar}` }}>
                                        <div className="border-b px-2 py-1 text-[11px] font-semibold">{BLOCK_NAMES[b.block_code] ?? b.block_code}</div>
                                        <div className="p-2">
                                            {controls.map((c, ci) => (
                                                <Slider key={ci} label={c.label} unit={c.range.unit} min={c.range.min} max={c.range.max} step={c.range.step} value={c.value}
                                                    onChange={(v) => setControl(realIdx, c.path, v)} />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="text-[10px] leading-snug text-muted-foreground">Ползунки — параметры блоков роли. Заказы (суммы и время расчёта) — по факту месяца, не меняются.</div>
                        </div>

                        {/* Результат по инженерам */}
                        <div className="overflow-y-auto p-4">
                            <div>
                                <div className="text-[11px] uppercase tracking-tight text-muted-foreground">ФОТ инженеров ({result.per.length} чел. · {totalOrders} заказов)</div>
                                <div className="text-3xl font-semibold tabular-nums">{formatNumberRu(result.total)} ₽</div>
                            </div>
                            {result.per.length === 0 ? (
                                <div className="mt-4 border border-dashed p-4 text-center text-xs text-muted-foreground">За {MONTHS[month - 1]} {year} у назначенных инженеров нет заказов, дошедших до производства.</div>
                            ) : (
                                <div className="mt-3 divide-y border">
                                    {result.per.map((p) => {
                                        const maxTotal = Math.max(...result.per.map((x) => x.total), 1);
                                        return (
                                            <div key={p.itemCode} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                                                <span className="w-40 shrink-0 truncate">{p.name}</span>
                                                <div className="relative h-4 flex-1 bg-muted">
                                                    <div className="absolute inset-y-0 left-0 bg-violet-400" style={{ width: `${(p.total / maxTotal) * 100}%` }} />
                                                </div>
                                                <span className="w-16 shrink-0 text-right text-muted-foreground">{p.orders} зак.</span>
                                                <span className="w-24 shrink-0 text-right tabular-nums">{formatNumberRu(p.total)} ₽</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="mt-2 text-[10px] leading-snug text-muted-foreground">Расчёт идёт тем же движком (compose), что и боевой. Меняешь параметры — сумма пересчитывается мгновенно. Ничего не сохраняется.</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Slider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
    const disp = unit === '×' ? '×' + value : unit === '%' ? value + '%' : unit === 'ч' ? value + ' ч' : unit === 'шт' ? value + ' шт' : formatNumberRu(Math.round(value)) + ' ₽';
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
