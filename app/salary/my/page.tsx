'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import ManagerSalarySimulatorModal from '../ManagerSalarySimulatorModal';
import { CountedOrdersSplit, ConversionOrdersTable, TeamOrdersTable } from '@/components/salary/salary-drilldowns';
import RecalcOverlay from '@/components/salary/RecalcOverlay';
import type { MyDashboard } from '@/lib/salary/my-dashboard';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const num = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU');

export default function MySalaryPage() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [row, setRow] = useState<any>(null);
    const [status, setStatus] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [details, setDetails] = useState<any>(null);
    const [dash, setDash] = useState<MyDashboard | null>(null);
    const [simOpen, setSimOpen] = useState(false);
    const [needsRecalc, setNeedsRecalc] = useState(false);
    const [recalculating, setRecalculating] = useState(false);
    const { toast } = useToast();
    const { user } = useAuth();
    const canEditParams = user?.role === 'admin' || user?.role === 'rop';

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/my?period=${year}-${month}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setRow(json.rows?.[0] ?? null);
            setStatus(json.period?.status ?? 'none');
            setDetails(json.details ?? null);
            setDash(json.dashboard ?? null);
            setNeedsRecalc(!!json.needsRecalc);
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [year, month, toast]);

    useEffect(() => { load(); }, [load]);

    const recalc = useCallback(async () => {
        setRecalculating(true);
        try {
            const res = await fetch('/api/salary/recalc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Ошибка пересчёта');
            await load();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setRecalculating(false);
        }
    }, [year, month, load, toast]);

    const b = row?.breakdown || {};
    const countedOrders: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
    const countedOrderIds: number[] = Array.isArray(b.countedOrderIds) ? b.countedOrderIds : [];
    const incoming: any[] = Array.isArray(details?.incoming) ? details.incoming : [];
    const teamOrders: any[] = Array.isArray(details?.teamOrders) ? details.teamOrders : [];
    const teamRevenueNoVat: number = details?.teamRevenueNoVat ?? 0;
    const isOpen = status !== 'closed';
    const totalLabel = isOpen ? 'Прогноз ЗП' : 'ЗП к выплате';

    return (
        <div className="mx-auto max-w-5xl space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">Моя зарплата</h1>
                <div className="ml-auto flex items-center gap-2">
                    {isOpen && <span className="border border-amber-500 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-600">{MONTHS[month - 1]} открыт — прогноз</span>}
                    <Button variant="outline" size="sm" onClick={() => setSimOpen(true)} title="Покрутить свои показатели и увидеть, как меняется ЗП">
                        <FlaskConical className="mr-2 h-4 w-4" /> Симулятор ЗП
                    </Button>
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            <div className="relative">
            {needsRecalc && !loading && (
                <RecalcOverlay canRecalc={canEditParams} recalculating={recalculating} onRecalc={recalc} />
            )}
            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !row ? (
                <div className="border border-dashed p-12 text-center text-muted-foreground">
                    За {MONTHS[month - 1]} {year} расчёта пока нет.
                </div>
            ) : (
                <div className="space-y-4">
                    {/* ── KPI ─────────────────────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                        <div className="bg-blue-600 p-4 text-white">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-blue-100">{totalLabel}</div>
                            <div className="mt-1 text-3xl font-extrabold tabular-nums">{rub(row.total)}</div>
                            <div className="mt-1 text-xs text-blue-100">
                                {isOpen ? 'по данным месяца · выплата после закрытия' : 'период закрыт'}
                            </div>
                        </div>
                        <Kpi label="Личный план"
                            value={dash?.plan.personalPct != null ? `${Math.round(dash.plan.personalPct)}%` : '—'}
                            valueClass={planColor(dash?.plan.personalPct, dash?.pace.expectedPct)}
                            meta={dash?.plan.personalTarget != null ? `${num(dash.plan.personalFact)} из ${num(dash.plan.personalTarget)} ₽` : 'план не задан'} />
                        <Kpi label="Скоринг ОКК"
                            value={dash?.okk.personal != null ? `${dash.okk.personal}%` : '—'}
                            meta={dash?.okk.department != null ? `отдел ${dash.okk.department}%` : 'нет оценок'} />
                        <Kpi label="Конверсия"
                            value={dash?.conversion.personalPct != null ? `${Math.round(dash.conversion.personalPct)}%` : '—'}
                            meta={dash?.conversion.departmentPct != null
                                ? `отдел ${Math.round(dash.conversion.departmentPct)}% · ${dash.conversion.numerator} из ${dash.conversion.denominator}`
                                : dash?.conversion.denominator ? `${dash.conversion.numerator} из ${dash.conversion.denominator} заявок` : 'нет заявок'} />
                        <Kpi label="До конца месяца"
                            value={dash?.pace.isCurrentMonth ? `${dash.pace.calendarDaysLeft} дн.` : '—'}
                            meta={dash?.pace.requiredPerDay != null && dash.pace.isCurrentMonth ? `нужно ${num(dash.pace.requiredPerDay)} ₽/дн` : 'месяц завершён'} />
                        {dash?.grade ? (
                            <Kpi label="Грейд"
                                value={`${dash.grade.level} / ${dash.grade.top}`}
                                meta={dash.grade.monthsToPromote != null ? `${dash.grade.streak} мес. подряд · до повышения ${dash.grade.monthsToPromote}` : `высший уровень`} />
                        ) : (
                            <Kpi label="Итого к выплате" value={rub(row.total)} meta={isOpen ? 'предварительно' : 'начислено'} />
                        )}
                    </div>

                    {/* ── План ────────────────────────────────────────────── */}
                    {dash && (dash.plan.personalTarget != null || dash.plan.deptTarget != null) && (
                        <Section title="Выполнение плана" hint="факт — по заказам, перешедшим «в производство»">
                            <div className="grid gap-2 md:grid-cols-2">
                                {dash.plan.personalTarget != null && (
                                    <PlanCard label="Личный план" fact={dash.plan.personalFact} target={dash.plan.personalTarget}
                                        pct={dash.plan.personalPct ?? 0} expected={dash.pace.expectedPct}
                                        foot={<>
                                            <span>Осталось <b>{rub(dash.plan.personalRemaining ?? 0)}</b></span>
                                            {dash.pace.isCurrentMonth && <><span>Твой темп <b>{num(dash.pace.factPerDay)} ₽/дн</b></span>
                                            {dash.pace.requiredPerDay != null && <span>Нужно <b>{num(dash.pace.requiredPerDay)} ₽/дн</b></span>}</>}
                                        </>} />
                                )}
                                {dash.plan.deptTarget != null && (
                                    <PlanCard label="План отдела" fact={dash.plan.deptFact} target={dash.plan.deptTarget}
                                        pct={dash.plan.deptPct ?? 0} expected={dash.pace.expectedPct}
                                        foot={<span>Влияет на твой <b>К_команды</b></span>} />
                                )}
                            </div>
                        </Section>
                    )}

                    {/* ── Предоплата ──────────────────────────────────────── */}
                    {dash?.prepay.available && dash.prepay.pct != null && (
                        <Section title="Предоплата" hint={`фактически оплачено по засчитанным заказам · порог ≥ ${dash.prepay.thresholdPct}%`}>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <Tile label="Средний % предоплаты"
                                    value={`${Math.round(dash.prepay.pct)}%`}
                                    valueClass={dash.prepay.passed ? 'text-emerald-600' : 'text-red-600'}
                                    meta={`норма ≥ ${dash.prepay.thresholdPct}% · без НДС`} />
                                <Tile label="Оплачено фактически" value={rub(dash.prepay.paid)} meta={`из ${rub(dash.prepay.base)} по ${countedOrders.length} заказам · без НДС`} />
                            </div>
                            <div className="mt-2 border p-3">
                                <ThinBar pct={dash.prepay.pct} mark={dash.prepay.thresholdPct ?? undefined} good={!!dash.prepay.passed} />
                                <div className="mt-2 text-xs text-muted-foreground">
                                    Предоплата <b className="text-foreground">{rub(dash.prepay.paid)}</b> из <b className="text-foreground">{rub(dash.prepay.base)}</b> = <b className={dash.prepay.passed ? 'text-emerald-600' : 'text-red-600'}>{Math.round(dash.prepay.pct)}%</b>
                                    {!dash.prepay.passed && <span className="ml-2">· ниже {dash.prepay.thresholdPct}% — премия под риском</span>}
                                </div>
                            </div>
                        </Section>
                    )}

                    {/* ── Ближайшие рубежи ────────────────────────────────── */}
                    {dash && dash.milestones.length > 0 && (
                        <Section title="Ближайшие рубежи" hint="что сделать, чтобы поднять ЗП">
                            <div className="grid gap-2 md:grid-cols-3">
                                {dash.milestones.map((m) => (
                                    <div key={m.code} className="border border-l-[3px] border-l-blue-600 p-3">
                                        <div className="text-sm font-semibold">{m.title}</div>
                                        {m.unit === 'rub' && <div className="mt-2 h-1.5 bg-muted"><div className="h-full bg-blue-600" style={{ width: `${m.progressPct}%` }} /></div>}
                                        <div className="mt-2 text-xs text-muted-foreground">{m.note}</div>
                                        <div className="mt-1 text-xl font-extrabold text-emerald-600">+{rub(m.gain)}</div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* ── Из чего сложится ЗП ──────────────────────────────── */}
                    <Section title={isOpen ? 'Из чего сложится ЗП' : 'Из чего сложилась ЗП'} hint={isOpen ? 'прогноз по текущим данным месяца' : undefined}>
                        <div className="border">
                            <table className="w-full text-sm">
                                <tbody>
                                    <Line label="Оклад" value={rub(row.oklad)} sub={b.okladProration != null && b.okladProration < 1 ? `${Math.round(b.okladProration * 100)}% месяца` : undefined} />
                                    <Line label={`Премия за заявки (${(b.counts?.new ?? 0) + (b.counts?.permanent ?? 0)} шт.)`} value={rub(row.premia_zayavki)} sub={`× К_качества ${row.k_quality}`} />
                                    {(() => {
                                        const contribs: any[] = Array.isArray(b.blockContributions) ? b.blockContributions : [];
                                        const cat = contribs.find((c) => c.code === 'premia_categorii');
                                        const coef = contribs.find((c) => c.code === 'coef_categorii');
                                        return (
                                            <>
                                                {cat && cat.amount ? <Line label="Премия за категории товаров" value={rub(cat.amount)} sub={`× К_качества ${row.k_quality}`} /> : null}
                                                {coef && coef.multiplier != null && coef.multiplier !== 1 ? <Line label="Коэффициент за категории" value={`× ${coef.multiplier}`} sub="множитель переменной части" /> : null}
                                            </>
                                        );
                                    })()}
                                    <Line label="Конв-бонус" value={rub(row.conv_bonus)} sub={`конверсия ${b.conversionPct ?? 0}%`} />
                                    <Line label="Бонус за скидочную дисциплину" value={rub(row.discount_bonus)} sub={b.discountValue != null ? `скидка ${b.discountValue}%` : undefined} />
                                    <Line label="К_команды (множитель переменной части)" value={`× ${row.k_team}`} />
                                    <tr className="border-t-2 font-semibold">
                                        <td className="py-2">Итого к выплате</td>
                                        <td className="py-2 text-right text-lg">{rub(row.total)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Section>

                    {/* ── Дотяни до порога ────────────────────────────────── */}
                    {dash && dash.thresholds.length > 0 && (
                        <Section title="Дотяни до порога" hint="показатели у границы бонуса">
                            <div className="border">
                                {dash.thresholds.map((t) => (
                                    <div key={t.code} className="grid grid-cols-1 items-center gap-2 border-b p-3 last:border-b-0 md:grid-cols-[1.6fr_1fr_1.4fr]">
                                        <div className="text-sm font-semibold">{t.name}<span className="block text-[11px] font-normal text-muted-foreground">{t.hint}</span></div>
                                        <div className="text-xs tabular-nums">
                                            <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-bold ${t.passed ? 'border-emerald-600 text-emerald-600' : 'border-amber-600 text-amber-600'}`}>
                                                {t.value != null ? `${t.value}%` : 'нет данных'}
                                            </span>
                                            <span className="ml-2 text-muted-foreground">{t.passed ? `порог ${t.threshold}% ✓` : `порог ${t.threshold}%`}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground md:text-right">
                                            {t.passed
                                                ? <>бонус активен → <b className="text-emerald-600">+{rub(t.active)}</b></>
                                                : t.gain > 0 ? <>достичь порога → <b className="text-emerald-600">+{rub(t.gain)}</b></> : 'дотянуть до порога'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* ── Детализация заказами ─────────────────────────────── */}
                    {(countedOrders.length > 0 || countedOrderIds.length > 0) && (() => {
                        const totalCounted = (b.counts?.new ?? 0) + (b.counts?.permanent ?? 0);
                        return (
                            <Section title={`Засчитанные заказы (${totalCounted || countedOrders.length || countedOrderIds.length})`}>
                                <CountedOrdersSplit orders={countedOrders} fallbackIds={countedOrderIds} permanentThreshold={dash?.permanentThreshold} />
                            </Section>
                        );
                    })()}

                    <Section title="Конв-бонус — поступившие заявки">
                        <ConversionOrdersTable orders={incoming} countedIds={countedOrderIds} numerator={b.conversionNumerator ?? countedOrderIds.length} />
                    </Section>

                    <Section title="К_команды — заказы отдела">
                        <TeamOrdersTable orders={teamOrders} teamRevenueNoVat={teamRevenueNoVat} />
                    </Section>

                    <div className="text-[11px] text-muted-foreground">
                        Нажмите на номер заказа, чтобы открыть карточку в ОКК и проверить данные расчёта.
                    </div>
                </div>
            )}
            </div>

            {simOpen && (
                <ManagerSalarySimulatorModal
                    managerId={row?.manager_id ?? user?.retail_crm_manager_id ?? 0}
                    managerName={[user?.last_name, user?.first_name].filter(Boolean).join(' ') || 'Моя зарплата'}
                    canEditParams={canEditParams}
                    initialYear={year}
                    initialMonth={month}
                    onClose={() => setSimOpen(false)}
                />
            )}
        </div>
    );
}

function planColor(pct?: number | null, expected?: number | null): string {
    if (pct == null || expected == null) return '';
    return pct + 1 >= expected ? 'text-emerald-600' : 'text-amber-600';
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
                {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </section>
    );
}

function Kpi({ label, value, meta, valueClass }: { label: string; value: string; meta?: string; valueClass?: string }) {
    return (
        <div className="border bg-card p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-1 text-3xl font-extrabold tabular-nums ${valueClass ?? ''}`}>{value}</div>
            {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
    );
}

function Tile({ label, value, meta, valueClass }: { label: string; value: string; meta?: string; valueClass?: string }) {
    return (
        <div className="border bg-card p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-1 text-2xl font-extrabold tabular-nums ${valueClass ?? ''}`}>{value}</div>
            {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
    );
}

function PlanCard({ label, fact, target, pct, expected, foot }: { label: string; fact: number; target: number; pct: number; expected: number; foot: React.ReactNode }) {
    const onTrack = pct + 1 >= expected;
    return (
        <div className="border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><span className="text-2xl font-extrabold tabular-nums">{num(fact)} ₽</span> <span className="text-sm font-semibold text-muted-foreground">/ {num(target)} ₽ — {label.toLowerCase()}</span></div>
                <span className={`border px-2 py-0.5 text-[11px] font-bold uppercase ${onTrack ? 'border-emerald-600 text-emerald-600' : 'border-amber-600 text-amber-600'}`}>{onTrack ? 'В графике' : 'Отстаёт'}</span>
            </div>
            <ThinBar pct={pct} mark={expected} good={onTrack} tall />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground [&_b]:text-foreground">{foot}</div>
        </div>
    );
}

function ThinBar({ pct, mark, good, tall }: { pct: number; mark?: number; good?: boolean; tall?: boolean }) {
    const w = Math.max(0, Math.min(100, pct));
    return (
        <div className={`relative ${tall ? 'my-3 h-3.5' : 'h-3.5'} border bg-muted`}>
            <div className={`h-full ${good ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${w}%` }} />
            {mark != null && mark > 0 && mark <= 100 && (
                <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-foreground" style={{ left: `${mark}%` }} title={`порог ${Math.round(mark)}%`} />
            )}
        </div>
    );
}

function Line({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <tr className="border-t">
            <td className="py-2 pl-3">
                {label}
                {sub && <span className="ml-2 text-xs text-muted-foreground">{sub}</span>}
            </td>
            <td className="py-2 pr-3 text-right">{value}</td>
        </tr>
    );
}
