'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Loader2, Save, RefreshCw, Check } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Человеческие названия метрик-критериев грейда (коды — только внутри).
const CRITERION_LABELS: Record<string, string> = {
    plan_attainment: 'Выполнение личного плана, %',
    conversion: 'Конверсия, %',
    okk_total_score: 'Скоринг качества ОКК',
    avg_check: 'Средний чек, ₽',
};
const MODE_LABELS: Record<string, string> = { absolute: 'Порог', dept_rank: 'Топ отдела' };
const COMPARATORS: Record<string, string> = { gte: '≥ не меньше', lte: '≤ не больше' };

type Criterion = { metric: string; mode: 'absolute' | 'dept_rank'; comparator?: 'gte' | 'lte'; threshold?: number; rank?: number; required: boolean };
type Policy = { floorLevel: number; topLevel: number; lookbackMonths: number; promoteAfterMonths: number; demoteAfterMonths: number; cohort: 'scheme' | 'register'; criteria: Criterion[] };

const inputCls = 'h-8 border px-2 text-xs';

export default function GradesTab() {
    const { toast } = useToast();
    const now = new Date();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [policyFrom, setPolicyFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    const [savingPolicy, setSavingPolicy] = useState(false);
    // пересчёт по последнему закрытому месяцу
    const [recYear, setRecYear] = useState(now.getFullYear());
    const [recMonth, setRecMonth] = useState(now.getMonth()); // прошлый месяц по умолчанию (closed)
    const [recomputing, setRecomputing] = useState(false);
    // ручной грейд
    const [manualFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    const [savingManual, setSavingManual] = useState<number | null>(null);
    const [recResult, setRecResult] = useState<any>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/salary/grades');
            const j = await res.json();
            if (j.error) throw new Error(j.error);
            setData(j);
            if (j.policy) setPolicy(j.policy);
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const currentLevel = (managerId: number): number | null => {
        const row = (data?.current ?? []).find((c: any) => c.managerId === managerId);
        return row ? row.level : null;
    };

    const recompute = async () => {
        setRecomputing(true); setRecResult(null);
        try {
            const res = await fetch('/api/salary/grades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ throughYear: recYear, throughMonth: recMonth }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            setRecResult(j);
            const changed = (j.rows ?? []).filter((r: any) => r.change !== 0).length;
            toast({ title: 'Грейды пересчитаны', description: `Изменений: ${changed}, действуют с ${String(j.effectiveFrom).slice(0, 10)}` });
            load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setRecomputing(false); }
    };

    const setManual = async (managerId: number, level: number) => {
        setSavingManual(managerId);
        try {
            const res = await fetch('/api/salary/grades', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', managerId, level, effectiveFrom: manualFrom }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Грейд установлен', description: `Уровень ${level} с ${manualFrom.slice(0, 10)}` });
            load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSavingManual(null); }
    };

    const savePolicy = async () => {
        if (!policy) return;
        setSavingPolicy(true);
        try {
            const res = await fetch('/api/salary/grades', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'policy', policy, effectiveFrom: policyFrom }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Ошибка');
            toast({ title: 'Политика грейдов сохранена' });
            load();
        } catch (e: any) { toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }); }
        finally { setSavingPolicy(false); }
    };

    const setP = (patch: Partial<Policy>) => setPolicy((p) => (p ? { ...p, ...patch } : p));
    const setCriterion = (i: number, patch: Partial<Criterion>) => setPolicy((p) => (p ? { ...p, criteria: p.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : p));

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    const managers = (data?.managers ?? []).filter((m: any) => m.active);
    const inRegistry = (id: number) => currentLevel(id) != null || (data?.ledger ?? []).some((l: any) => l.managerId === id);

    return (
        <div className="space-y-4">
            <div className="border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                Грейд — авто-повышающийся ранг менеджера: <b>{policy?.topLevel ?? 1}</b> высший … <b>{policy?.floorLevel ?? 3}</b> низший (ниже не падает).
                Растёт за выполнение показателей <b>{policy?.promoteAfterMonths ?? 3}</b> мес. подряд, откатывается за невыполнение <b>{policy?.demoteAfterMonths ?? 2}</b> мес. подряд.
                Множитель к переменной части задаётся блоком «Грейд-коэффициент» в схеме. Пересчёт идёт по последнему закрытому месяцу (закрытые периоды не меняются).
            </div>

            {/* ── Текущие грейды ── */}
            <section>
                <div className="mb-1 text-xs font-semibold uppercase tracking-tight">Текущие грейды</div>
                <div className="overflow-x-auto border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">Менеджер</th><th className="px-2 py-1.5">Грейд</th><th className="px-2 py-1.5">Ручная установка с {manualFrom.slice(0, 10)}</th></tr></thead>
                        <tbody>
                            {managers.map((m: any) => {
                                const lvl = currentLevel(m.id);
                                return (
                                    <tr key={m.id} className={`border-t ${inRegistry(m.id) ? '' : 'opacity-50'}`}>
                                        <td className="px-2 py-1">{m.name} <span className="text-[11px] text-muted-foreground">#{m.id}</span></td>
                                        <td className="px-2 py-1 font-semibold">{lvl == null ? <span className="font-normal text-muted-foreground">— не назначен —</span> : lvl}</td>
                                        <td className="px-2 py-1">
                                            <div className="flex items-center gap-1">
                                                {Array.from({ length: (policy?.floorLevel ?? 3) - (policy?.topLevel ?? 1) + 1 }, (_, k) => (policy?.topLevel ?? 1) + k).map((L) => (
                                                    <button key={L} onClick={() => setManual(m.id, L)} disabled={savingManual === m.id}
                                                        className={`h-7 w-7 border text-xs ${lvl === L ? 'bg-slate-900 text-white' : 'hover:bg-accent'}`}>{savingManual === m.id ? '…' : L}</button>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── Пересчёт ── */}
            <section>
                <div className="mb-1 text-xs font-semibold uppercase tracking-tight">Пересчёт по закрытому месяцу</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Последний закрытый месяц:</span>
                    <select value={recMonth} onChange={(e) => setRecMonth(Number(e.target.value))} className={inputCls}>{MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}</select>
                    <select value={recYear} onChange={(e) => setRecYear(Number(e.target.value))} className={inputCls}>{[recYear - 1, recYear, recYear + 1].map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
                    <Button size="sm" className="h-8" onClick={recompute} disabled={recomputing}>{recomputing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Пересчитать</Button>
                    {recResult && <span className="flex items-center gap-1 text-green-600"><Check className="h-3.5 w-3.5" /> с {String(recResult.effectiveFrom).slice(0, 10)}: изменений {(recResult.rows ?? []).filter((r: any) => r.change !== 0).length}</span>}
                </div>
                {recResult && (recResult.rows ?? []).length > 0 && (
                    <div className="mt-2 overflow-x-auto border">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1">Менеджер</th><th className="px-2 py-1">Было</th><th className="px-2 py-1">Стало</th><th className="px-2 py-1">Стрик ✓</th><th className="px-2 py-1">Стрик ✗</th></tr></thead>
                            <tbody>
                                {(recResult.rows ?? []).map((r: any) => {
                                    const m = (data?.managers ?? []).find((x: any) => x.id === r.managerId);
                                    return (
                                        <tr key={r.managerId} className={`border-t ${r.change !== 0 ? 'bg-amber-50' : ''}`}>
                                            <td className="px-2 py-1">{m?.name ?? `#${r.managerId}`}</td>
                                            <td className="px-2 py-1">{r.prevLevel}</td>
                                            <td className="px-2 py-1 font-semibold">{r.newLevel}{r.change < 0 ? ' ↑' : r.change > 0 ? ' ↓' : ''}</td>
                                            <td className="px-2 py-1">{r.qualStreak}</td>
                                            <td className="px-2 py-1">{r.failStreak}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ── Политика ── */}
            {policy && (
                <section>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-tight">Политика грейдов</div>
                    <div className="space-y-2 border bg-white p-3">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            <label className="flex items-center justify-between gap-2 text-xs">Высший грейд<NumberInput value={policy.topLevel} onChange={(v) => setP({ topLevel: v ?? 1 })} className={`${inputCls} w-20 text-right`} /></label>
                            <label className="flex items-center justify-between gap-2 text-xs">Низший грейд (пол)<NumberInput value={policy.floorLevel} onChange={(v) => setP({ floorLevel: v ?? 3 })} className={`${inputCls} w-20 text-right`} /></label>
                            <label className="flex items-center justify-between gap-2 text-xs">Глубина окна, мес.<NumberInput value={policy.lookbackMonths} onChange={(v) => setP({ lookbackMonths: v ?? 6 })} className={`${inputCls} w-20 text-right`} /></label>
                            <label className="flex items-center justify-between gap-2 text-xs">+1 за N мес. подряд<NumberInput value={policy.promoteAfterMonths} onChange={(v) => setP({ promoteAfterMonths: v ?? 3 })} className={`${inputCls} w-20 text-right`} /></label>
                            <label className="flex items-center justify-between gap-2 text-xs">−1 за N мес. подряд<NumberInput value={policy.demoteAfterMonths} onChange={(v) => setP({ demoteAfterMonths: v ?? 2 })} className={`${inputCls} w-20 text-right`} /></label>
                            <label className="flex items-center justify-between gap-2 text-xs">Когорта сравнения
                                <select value={policy.cohort} onChange={(e) => setP({ cohort: e.target.value as any })} className={inputCls}><option value="scheme">Та же роль</option><option value="register">Весь реестр</option></select>
                            </label>
                        </div>

                        <div className="mt-1 text-[11px] font-medium text-muted-foreground">Критерии выполнения месяца</div>
                        <div className="border">
                            <table className="w-full text-xs">
                                <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="px-2 py-1">Показатель</th><th className="px-2 py-1">Режим</th><th className="px-2 py-1">Условие</th><th className="px-2 py-1 text-center">Обязателен</th></tr></thead>
                                <tbody>
                                    {policy.criteria.map((c, i) => (
                                        <tr key={c.metric} className="border-t">
                                            <td className="px-2 py-1">{CRITERION_LABELS[c.metric] ?? c.metric}</td>
                                            <td className="px-2 py-1">
                                                <select value={c.mode} onChange={(e) => setCriterion(i, { mode: e.target.value as any })} className={inputCls}>{Object.entries(MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                            </td>
                                            <td className="px-2 py-1">
                                                {c.mode === 'absolute' ? (
                                                    <div className="flex items-center gap-1">
                                                        <select value={c.comparator ?? 'gte'} onChange={(e) => setCriterion(i, { comparator: e.target.value as any })} className={inputCls}>{Object.entries(COMPARATORS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                                        <NumberInput value={c.threshold ?? 0} onChange={(v) => setCriterion(i, { threshold: v ?? 0 })} className={`${inputCls} w-24 text-right`} />
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">топ-<NumberInput value={c.rank ?? 1} onChange={(v) => setCriterion(i, { rank: v ?? 1 })} className={`${inputCls} w-16 text-right`} /></div>
                                                )}
                                            </td>
                                            <td className="px-2 py-1 text-center"><input type="checkbox" checked={c.required} onChange={(e) => setCriterion(i, { required: e.target.checked })} className="h-4 w-4 accent-primary" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                            <span className="text-[11px] text-muted-foreground">Действует с</span>
                            <input type="date" value={policyFrom} onChange={(e) => setPolicyFrom(e.target.value)} className={inputCls} />
                            <Button size="sm" className="h-8" onClick={savePolicy} disabled={savingPolicy}>{savingPolicy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />} Сохранить политику</Button>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
