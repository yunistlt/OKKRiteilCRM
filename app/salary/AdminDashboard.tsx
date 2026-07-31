'use client';

import { formatIntRu, formatRub } from '@/lib/format';
import type { AdminDashboard as Dash, AdminManagerRow } from '@/lib/salary/admin-dashboard';

// ============================================================================
// Вкладка «Дашборд» на /salary — консолидированный взгляд руководителя на отдел.
// Вёрстка рассчитана на ЦЕНТРАЛЬНУЮ колонку (слева меню, справа чат Семёна):
// сетки — auto-fit по ширине контейнера, широкие таблицы прокручиваются ВНУТРИ
// своего блока, страница по горизонтали не едет.
// ============================================================================

const rub = (n: number | null | undefined) => (n == null ? '—' : formatRub(n));
const pct = (n: number | null | undefined, digits = 0) =>
    n == null ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: digits })}%`;
const mult = (k: number | null | undefined) => (k == null ? '—' : `×${k.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`);

/** Короткая сумма для узких колонок: «4,85 млн», «250 тыс.», «980 ₽». */
function short(n: number | null | undefined): string {
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн`;
    if (a >= 10_000) return `${Math.round(n / 1000).toLocaleString('ru-RU')} тыс.`;
    return formatIntRu(n);
}

const SERIES = ['#2563eb', '#0891b2', '#7c3aed', '#16a34a', '#d97706', '#db2777', '#0f766e', '#9333ea'];

export default function AdminDashboard({
    dash,
    monthLabel,
    isOpen,
    onOpenManager,
}: {
    dash: Dash;
    monthLabel: string;
    isOpen: boolean;
    onOpenManager: (managerId: number) => void;
}) {
    const t = dash.totals;
    const ms = dash.managers;
    const colorById = new Map(ms.map((m, i) => [m.managerId, SERIES[i % SERIES.length]]));

    return (
        <div className="flex flex-col gap-4">
            {/* ── KPI ─────────────────────────────────────────────────────── */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                <div className="bg-blue-600 p-3 text-white">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-blue-100">
                        {isOpen ? 'ФОТ отдела — прогноз' : 'ФОТ отдела'}
                    </div>
                    <div className="mt-1 text-2xl font-extrabold tabular-nums">{rub(t.fotAll)}</div>
                    <div className="mt-1 text-[11px] text-blue-100">
                        менеджеры {rub(t.fot)}{t.engineersFot > 0 ? ` + инженеры ${rub(t.engineersFot)}` : ''}
                    </div>
                </div>
                <Kpi label="Выручка отдела" value={rub(t.revenueNoVat)}
                    meta={t.planDept != null ? `${pct(t.planDeptPct)} плана ${rub(t.planDept)} · без НДС` : 'план отдела не задан'} />
                <Kpi label="Зарплатоёмкость" value={pct(t.salaryToRevenuePct, 1)}
                    meta="ФОТ менеджеров ÷ выручка" />
                <Kpi label="Скоринг ОКК за месяц" value={pct(t.qualityScore)}
                    meta={`средний по ${ms.length} менеджерам`} />
                <Kpi label="Конверсия отдела" value={pct(t.conversionPct)}
                    meta={t.conversionDen > 0 ? `${formatIntRu(t.conversionNum)} из ${formatIntRu(t.conversionDen)} заявок` : 'нет заявок'} />
                <Kpi label={dash.pace.isCurrentMonth ? 'До конца месяца' : 'Период'}
                    value={dash.pace.isCurrentMonth ? `${dash.pace.calendarDaysLeft} дн.` : monthLabel.split(' ')[0]}
                    meta={t.planDeptRemaining != null && t.planDeptRemaining > 0 ? `до плана отдела ${rub(t.planDeptRemaining)}` : 'план отдела выполнен'} />
            </div>

            {/* ── План ────────────────────────────────────────────────────── */}
            {(t.planDept != null || ms.some((m) => m.planTarget != null)) && (
                <Section title="Выполнение плана" hint="факт — по заказам, перешедшим «в производство», без НДС">
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
                        {t.planDept != null && (
                            <div className="border border-slate-300 bg-white p-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <div>
                                        <span className="text-xl font-extrabold tabular-nums">{rub(t.revenueNoVat)}</span>{' '}
                                        <span className="text-xs text-slate-500">/ {rub(t.planDept)} — план отдела</span>
                                    </div>
                                    <Badge ok={(t.planDeptPct ?? 0) >= 100}>{pct(t.planDeptPct)}</Badge>
                                </div>
                                {/* Вклад каждого менеджера в план отдела */}
                                <div className="relative my-2 flex h-4 border border-slate-300 bg-slate-200">
                                    {ms.map((m) => (
                                        <span key={m.managerId} title={`${m.name}: ${rub(m.revenueNoVat)}`}
                                            style={{ width: `${Math.max(0, Math.min(100, (m.revenueNoVat / (t.planDept || 1)) * 100))}%`, background: colorById.get(m.managerId) }} />
                                    ))}
                                    <span className="absolute -top-1 bottom-[-4px] w-0.5 bg-slate-900" style={{ left: '100%' }} />
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                    {ms.map((m) => (
                                        <span key={m.managerId}>
                                            <i className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: colorById.get(m.managerId) }} />
                                            {m.name} {short(m.revenueNoVat)} ₽
                                        </span>
                                    ))}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 [&_b]:text-slate-900">
                                    {t.planDeptRemaining != null && <span>Осталось <b>{rub(t.planDeptRemaining)}</b></span>}
                                    {dash.pace.requiredPerDay != null && dash.pace.isCurrentMonth && (
                                        <span>Нужно <b>{rub(dash.pace.requiredPerDay)}/раб. день</b></span>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="border border-slate-300 bg-white p-3">
                            <div className="mb-2 text-xs text-slate-500">Личные планы</div>
                            {ms.map((m) => (
                                <div key={m.managerId} className="grid items-center gap-2 border-b py-1.5 last:border-b-0"
                                    style={{ gridTemplateColumns: 'minmax(120px,1.2fr) minmax(80px,2fr) minmax(96px,auto)' }}>
                                    <div className="truncate text-[13px] font-semibold" title={m.name}>{m.name}</div>
                                    <div className="relative flex h-2.5 border border-slate-300 bg-slate-200">
                                        <span className={(m.planPct ?? 0) >= 100 ? 'bg-emerald-600' : (m.planPct ?? 0) >= (dash.pace.expectedPct - 1) ? 'bg-amber-500' : 'bg-red-600'}
                                            style={{ width: `${Math.max(0, Math.min(100, m.planPct ?? 0))}%` }} />
                                        <span className="absolute -top-1 bottom-[-4px] w-0.5 bg-slate-900" style={{ left: '100%' }} />
                                    </div>
                                    <div className="text-right text-[12px] tabular-nums">
                                        <b>{pct(m.planPct)}</b>{' '}
                                        <span className="text-slate-500">{short(m.revenueNoVat)} / {short(m.planTarget)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
            )}

            {/* ── Структура ФОТ ───────────────────────────────────────────── */}
            <Section title="Из чего сложился ФОТ" hint="каждое начисление — своей строкой, каждый коэффициент — своей, с эффектом в рублях">
                <div className="overflow-x-auto border border-slate-300">
                    <table className="w-full text-[13px]">
                        <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="p-2 text-left">Блок мотивации</th>
                                <th className="whitespace-nowrap p-2 text-right">Сумма</th>
                                <th className="whitespace-nowrap p-2 text-right">Доля</th>
                                {ms.map((m) => (
                                    <th key={m.managerId} className="whitespace-nowrap p-2 text-right">{shortName(m.name)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {dash.blocks.map((b) => (
                                <tr key={b.code} className="border-t">
                                    <td className="p-2">{b.name}</td>
                                    <td className={`whitespace-nowrap p-2 text-right tabular-nums ${b.total ? '' : 'text-slate-500'}`}>{rub(b.total)}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums text-slate-500">
                                        {t.fot > 0 ? pct((b.total / t.fot) * 100, 1) : '—'}
                                    </td>
                                    {ms.map((m) => (
                                        <td key={m.managerId} className={`whitespace-nowrap p-2 text-right tabular-nums ${b.byManager[m.managerId] == null ? 'text-slate-300' : b.byManager[m.managerId] ? '' : 'text-slate-500'}`}>
                                            {b.byManager[m.managerId] == null ? '—' : rub(b.byManager[m.managerId])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            <tr className="border-t bg-slate-50 font-semibold">
                                <td className="p-2">Начислено до коэффициентов</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{rub(t.grossBeforeMultipliers)}</td>
                                <td className="p-2" />
                                {ms.map((m) => (
                                    <td key={m.managerId} className="whitespace-nowrap p-2 text-right tabular-nums">{rub(m.grossBeforeMultipliers)}</td>
                                ))}
                            </tr>
                            {dash.multipliers.map((mu) => (
                                <tr key={mu.code} className="border-t">
                                    <td className="p-2">
                                        {mu.name}
                                        <span className="ml-2 text-[11px] text-slate-500">
                                            {mu.scope === 'premia' ? 'множит премию' : 'множит переменную часть'}
                                        </span>
                                    </td>
                                    <td className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${mu.totalEffect < 0 ? 'text-red-600' : mu.totalEffect > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                        {mu.totalEffect > 0 ? '+' : ''}{rub(mu.totalEffect)}
                                    </td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums text-slate-500">
                                        {t.fot > 0 ? pct((mu.totalEffect / t.fot) * 100, 1) : '—'}
                                    </td>
                                    {ms.map((m) => {
                                        const cell = mu.byManager[m.managerId];
                                        return (
                                            <td key={m.managerId} className="whitespace-nowrap p-2 text-right tabular-nums">
                                                {cell?.k == null ? <span className="text-slate-300">—</span> : (
                                                    <>
                                                        <span className="font-semibold">{mult(cell.k)}</span>{' '}
                                                        <span className={cell.effect < 0 ? 'text-red-600' : cell.effect > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                                                            {cell.effect > 0 ? '+' : ''}{rub(cell.effect)}
                                                        </span>
                                                    </>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="border-t bg-slate-50 font-semibold">
                            <tr>
                                <td className="p-2">ФОТ менеджеров</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{rub(t.fot)}</td>
                                <td className="p-2 text-right tabular-nums">100%</td>
                                {ms.map((m) => (
                                    <td key={m.managerId} className="whitespace-nowrap p-2 text-right tabular-nums">{rub(m.total)}</td>
                                ))}
                            </tr>
                            {t.engineersFot > 0 && (
                                <tr>
                                    <td className="p-2">Инженеры-расчётчики</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{rub(t.engineersFot)}</td>
                                    <td className="p-2" />
                                    <td className="p-2 text-right text-[11px] font-normal text-slate-500" colSpan={ms.length}>
                                        ФОТ всего {rub(t.fotAll)}
                                    </td>
                                </tr>
                            )}
                        </tfoot>
                    </table>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                    Коэффициенты умножают премию и переменную часть, но не оклад и не разовые выплаты. Эффект — сколько рублей коэффициент добавил или снял.
                </div>
            </Section>

            {/* ── Сравнение менеджеров ────────────────────────────────────── */}
            <Section title="Менеджеры — сравнение" hint="клик по строке — подробный отчёт с формулой и заказами">
                <div className="overflow-x-auto border border-slate-300">
                    <table className="w-full text-[13px]">
                        <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="p-2 text-left">Менеджер</th>
                                <th className="whitespace-nowrap p-2 text-right">Выручка</th>
                                <th className="whitespace-nowrap p-2 text-right">% плана</th>
                                <th className="whitespace-nowrap p-2 text-right">Заказов</th>
                                <th className="whitespace-nowrap p-2 text-right">Конверсия</th>
                                <th className="whitespace-nowrap p-2 text-right">Скоринг</th>
                                <th className="whitespace-nowrap p-2 text-right">Предоплата</th>
                                {dash.grade && <th className="whitespace-nowrap p-2 text-right">Грейд</th>}
                                <th className="whitespace-nowrap p-2 text-right">ЗП</th>
                                <th className="whitespace-nowrap p-2 text-right">Доля ФОТ</th>
                                <th className="whitespace-nowrap p-2 text-right">ЗП к выручке</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ms.map((m) => (
                                <tr key={m.managerId} className="cursor-pointer border-t hover:bg-slate-50"
                                    onClick={() => onOpenManager(m.managerId)} title="Открыть подробный отчёт">
                                    <td className="p-2">
                                        <div className="font-semibold">{m.name}</div>
                                        {m.schemeName && <div className="text-[11px] text-slate-500">{m.schemeName}</div>}
                                    </td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{short(m.revenueNoVat)} ₽</td>
                                    <td className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${planClass(m, dash.pace.expectedPct)}`}>{pct(m.planPct)}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatIntRu(m.orders)}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                                        {pct(m.conversionPct)}
                                        <span className="ml-1 text-[11px] text-slate-500">{m.conversionNum}/{m.conversionDen}</span>
                                    </td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(m.qualityScore)}</td>
                                    <td className={`whitespace-nowrap p-2 text-right tabular-nums ${m.prepayPassed === false ? 'bg-red-50 font-semibold text-red-600' : m.prepayPassed ? 'text-emerald-600' : ''}`}>
                                        {pct(m.prepayPct)}
                                    </td>
                                    {dash.grade && <td className="whitespace-nowrap p-2 text-right tabular-nums">{m.grade ?? '—'} / {dash.grade.floor}</td>}
                                    <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">{rub(m.total)}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums text-slate-500">{pct(m.fotSharePct)}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums text-slate-500">{pct(m.salaryToRevenuePct, 1)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="border-t bg-slate-50 font-semibold">
                            <tr>
                                <td className="p-2">Отдел</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{short(t.revenueNoVat)} ₽</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(t.planDeptPct)}</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatIntRu(t.orders)}</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(t.conversionPct)}</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(t.qualityScore)}</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(t.prepayPct)}</td>
                                {dash.grade && <td className="p-2" />}
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{rub(t.fot)}</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">100%</td>
                                <td className="whitespace-nowrap p-2 text-right tabular-nums">{pct(t.salaryToRevenuePct, 1)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                {t.prepayThresholdPct != null && (
                    <div className="mt-1 text-[11px] text-slate-500">
                        Предоплата: норма ≥ {pct(t.prepayThresholdPct)} по засчитанным заказам. Цвет — отношение к порогу из схемы менеджера, не к средней по отделу.
                    </div>
                )}
            </Section>

            {/* ── Требует внимания ────────────────────────────────────────── */}
            {dash.alerts.length > 0 && (
                <Section title="Требует внимания" hint="строится из ступеней и порогов назначенных схем">
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
                        {dash.alerts.map((a) => (
                            <div key={a.code}
                                className={`border border-slate-300 border-l-[3px] bg-white p-3 ${a.level === 'bad' ? 'border-l-red-600' : a.level === 'warn' ? 'border-l-amber-500' : 'border-l-blue-600'}`}>
                                <div className="text-[13px] font-semibold">{a.title}</div>
                                <div className="mt-1 text-[12px] text-slate-500">{a.detail}</div>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* ── Динамика ────────────────────────────────────────────────── */}
            {dash.history.length > 1 && (
                <Section title="Динамика" hint="периоды с расчётом · ФОТ менеджеров и выручка отдела">
                    <div className="border border-slate-300 bg-white p-3">
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${dash.history.length},minmax(0,1fr))` }}>
                            {dash.history.map((h) => {
                                const maxRev = Math.max(...dash.history.map((x) => x.revenue), 1);
                                const maxFot = Math.max(...dash.history.map((x) => x.fot), 1);
                                return (
                                    <div key={`${h.year}-${h.month}`} className="flex flex-col gap-1">
                                        <div className="flex h-24 items-end gap-1">
                                            <span className="flex-1 bg-blue-600" style={{ height: `${(h.revenue / maxRev) * 100}%` }} title={`Выручка ${rub(h.revenue)}`} />
                                            <span className="flex-1 bg-slate-400" style={{ height: `${(h.fot / maxFot) * 100}%` }} title={`ФОТ ${rub(h.fot)}`} />
                                        </div>
                                        <div className="text-center text-[12px] font-bold tabular-nums">{pct(h.ratioPct, 1)}</div>
                                        <div className="truncate text-center text-[11px] text-slate-500">
                                            {MONTHS_SHORT[h.month - 1]} · {short(h.revenue)} / {short(h.fot)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                            <span><i className="mr-1 inline-block h-2 w-2 bg-blue-600 align-middle" />Выручка отдела</span>
                            <span><i className="mr-1 inline-block h-2 w-2 bg-slate-400 align-middle" />ФОТ менеджеров</span>
                            <span>Число под столбцами — зарплатоёмкость. Ряды масштабированы каждый к своему максимуму.</span>
                        </div>
                    </div>
                </Section>
            )}
        </div>
    );
}

const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/** «Евгения Матвеева» → «Матвеева» (узкие колонки таблицы структуры ФОТ). */
function shortName(name: string): string {
    const parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : name;
}

function planClass(m: AdminManagerRow, expectedPct: number): string {
    if (m.planPct == null) return '';
    if (m.planPct >= 100) return 'text-emerald-600';
    if (m.planPct + 1 >= expectedPct) return 'text-amber-600';
    return 'text-red-600';
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-1.5 flex items-baseline gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wide">{title}</h2>
                {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
            </div>
            {children}
        </section>
    );
}

function Kpi({ label, value, meta }: { label: string; value: string; meta?: string }) {
    return (
        <div className="border border-slate-300 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
            {meta && <div className="mt-1 text-[11px] text-slate-500">{meta}</div>}
        </div>
    );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return (
        <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase ${ok ? 'border-emerald-600 text-emerald-600' : 'border-amber-600 text-amber-600'}`}>
            {ok ? 'выполнен' : 'отстаёт'} · {children}
        </span>
    );
}
