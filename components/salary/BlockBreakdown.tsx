'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BlockContribution, TariffLine } from '@/lib/salary/blocks/types';

// ============================================================================
// «Из чего сложилась ЗП» — строки по блокам назначенной схемы + ТАРИФ каждого
// блока (ставки/пороги/ступени из параметров схемы в БД). Общий код для личного
// кабинета (/salary/my) и админского отчёта (/salary).
// Ноль хардкода: и суммы, и тарифы приходят из расчёта (blockContributions).
// ============================================================================

const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

const contribValue = (c: BlockContribution) => (c.kind === 'multiplier' ? `× ${c.multiplier ?? 1}` : rub(c.amount ?? 0));

export default function BlockBreakdown({
    contributions,
    total,
    totalLabel = 'Итого к выплате',
    defaultOpen = false,
}: {
    contributions: BlockContribution[];
    total: number;
    totalLabel?: string;
    defaultOpen?: boolean;
}) {
    const [openAll, setOpenAll] = useState(defaultOpen);
    // gen меняется на «показать/скрыть все» → строки перемонтируются и берут новое состояние
    // как начальное (дальше каждая строка раскрывается/сворачивается сама по клику).
    const [gen, setGen] = useState(0);
    const hasTariffs = contributions.some((c) => (c.tariff?.length ?? 0) > 0);

    return (
        <div className="border">
            {hasTariffs && (
                <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
                    <span className="text-[11px] text-muted-foreground">Тариф — ставки и пороги, по которым считается мотивация</span>
                    <button
                        type="button"
                        onClick={() => { setOpenAll((v) => !v); setGen((g) => g + 1); }}
                        className="border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide hover:bg-muted"
                    >
                        {openAll ? 'Скрыть тарифы' : 'Показать тарифы'}
                    </button>
                </div>
            )}
            <table className="w-full text-sm">
                <tbody>
                    {contributions.map((c) => (
                        <BlockRow key={`${c.code}-${gen}`} c={c} initialOpen={openAll} />
                    ))}
                    <tr className="border-t-2 font-semibold">
                        <td className="py-2 pl-3">{totalLabel}</td>
                        <td className="py-2 pr-3 text-right text-lg">{rub(total)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

function BlockRow({ c, initialOpen }: { c: BlockContribution; initialOpen: boolean }) {
    const [open, setOpen] = useState(initialOpen);
    const tariff = c.tariff ?? [];
    const shown = open;
    return (
        <>
            <tr className={`border-t ${tariff.length ? 'cursor-pointer hover:bg-muted/30' : ''}`} onClick={() => tariff.length && setOpen((v) => !v)}>
                <td className="py-2 pl-3">
                    <div className="flex items-baseline gap-1.5">
                        {tariff.length > 0 &&
                            (shown ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />)}
                        <span>{c.name}</span>
                        {c.explain && <span className="text-xs text-muted-foreground">{c.explain}</span>}
                        {c.dataFill && c.dataFill.pct < 1 && (
                            <span className="bg-amber-100 px-1 text-[10px] text-amber-700">данные {Math.round(c.dataFill.pct * 100)}%</span>
                        )}
                    </div>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-right">{contribValue(c)}</td>
            </tr>
            {shown && tariff.length > 0 && (
                <tr className="border-t border-dashed bg-muted/20">
                    <td colSpan={2} className="px-3 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Тариф</div>
                        <div className="mt-1 grid gap-x-6 gap-y-0.5 md:grid-cols-2">
                            {tariff.map((t, i) => (
                                <TariffRow key={i} t={t} />
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function TariffRow({ t }: { t: TariffLine }) {
    return (
        <div className={`flex items-baseline justify-between gap-3 border-b border-dashed py-0.5 text-xs last:border-0 ${t.active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            <span>
                {t.label}
                {t.active && <span className="ml-1.5 text-[10px] uppercase text-emerald-600">действует</span>}
            </span>
            <span className="whitespace-nowrap tabular-nums">{t.value}</span>
        </div>
    );
}
