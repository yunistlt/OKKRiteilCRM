'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, CalendarClock, Settings, Download, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';
import DutyModal from './DutyModal';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

interface CalcRow {
    manager_id: number;
    manager_name: string;
    oklad: number;
    premia_zayavki: number;
    k_quality: number;
    conv_bonus: number;
    discount_bonus: number;
    duty_pay: number;
    k_team: number;
    total: number;
    margin_info: number;
    breakdown: any;
}

export default function SalaryDashboard() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [data, setData] = useState<{ period: any; rows: CalcRow[]; total: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [recalculating, setRecalculating] = useState(false);
    const [closing, setClosing] = useState(false);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [dutyOpen, setDutyOpen] = useState(false);
    const { toast } = useToast();

    const period = `${year}-${month}`;
    const closed = data?.period?.status === 'closed';

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary?period=${period}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);
        } catch (e: any) {
            toast({ title: 'Ошибка загрузки', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [period, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const recalc = async () => {
        setRecalculating(true);
        try {
            const res = await fetch('/api/salary/recalc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Ошибка пересчёта');
            toast({ title: 'Пересчитано', description: `${MONTHS[month - 1]} ${year}: ${json.results?.length ?? 0} менеджеров` });
            fetchData();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setRecalculating(false);
        }
    };

    const closePeriod = async () => {
        if (!confirm(`Закрыть период ${MONTHS[month - 1]} ${year}? После закрытия расчёт неизменяем, правки — только корректировками.`)) return;
        setClosing(true);
        try {
            const res = await fetch('/api/salary/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Ошибка закрытия');
            toast({ title: 'Период закрыт', description: `${MONTHS[month - 1]} ${year}` });
            fetchData();
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setClosing(false);
        }
    };

    const rows = data?.rows ?? [];

    return (
        <div className="mx-auto max-w-6xl space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">Зарплата ОП</h1>
                <div className="ml-auto flex items-center gap-2">
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <Button variant="outline" size="sm" onClick={() => setDutyOpen(true)}>
                        <CalendarClock className="mr-2 h-4 w-4" /> Дежурства
                    </Button>
                    <Link href="/salary/settings">
                        <Button variant="outline" size="sm"><Settings className="mr-2 h-4 w-4" /> Настройки</Button>
                    </Link>
                    {rows.length > 0 && (
                        <a href={`/api/salary/export?period=${period}`}>
                            <Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" /> Excel</Button>
                        </a>
                    )}
                    <Button size="sm" onClick={recalc} disabled={recalculating || closed}>
                        {recalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Пересчитать
                    </Button>
                    {rows.length > 0 && !closed && (
                        <Button variant="destructive" size="sm" onClick={closePeriod} disabled={closing}>
                            {closing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                            Закрыть период
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>Период: {MONTHS[month - 1]} {year}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${closed ? 'bg-gray-200 text-gray-700' : data?.period?.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {closed ? 'закрыт' : data?.period?.status === 'open' ? 'открыт' : 'не рассчитан'}
                </span>
                {rows.length > 0 && <span className="ml-auto font-medium text-foreground">ФОТ отдела: {rub(data!.total)}</span>}
            </div>

            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
                    Расчёта за этот период нет. Нажмите «Пересчитать».
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                            <tr>
                                <th className="p-3"></th>
                                <th className="p-3">Менеджер</th>
                                <th className="p-3 text-right">Оклад</th>
                                <th className="p-3 text-right">Премия</th>
                                <th className="p-3 text-right">К_кач</th>
                                <th className="p-3 text-right">Конв</th>
                                <th className="p-3 text-right">Скидка</th>
                                <th className="p-3 text-right">К_ком</th>
                                <th className="p-3 text-right">Деж</th>
                                <th className="p-3 text-right font-semibold">Итого</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <RowGroup key={r.manager_id} r={r} expanded={expanded === r.manager_id} onToggle={() => setExpanded(expanded === r.manager_id ? null : r.manager_id)} />
                            ))}
                        </tbody>
                        <tfoot className="border-t bg-muted/30 font-semibold">
                            <tr>
                                <td className="p-3" colSpan={9}>ФОТ отдела {rows.length > 0 && `(К_команды ${rows[0].k_team})`}</td>
                                <td className="p-3 text-right">{rub(data!.total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {dutyOpen && <DutyModal period={period} monthLabel={`${MONTHS[month - 1]} ${year}`} onClose={() => setDutyOpen(false)} />}
        </div>
    );
}

function RowGroup({ r, expanded, onToggle }: { r: CalcRow; expanded: boolean; onToggle: () => void }) {
    const b = r.breakdown || {};
    return (
        <>
            <tr className="cursor-pointer border-t hover:bg-muted/30" onClick={onToggle}>
                <td className="p-3">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                <td className="p-3 font-medium">{r.manager_name}</td>
                <td className="p-3 text-right">{rub(r.oklad)}</td>
                <td className="p-3 text-right">{rub(r.premia_zayavki)}</td>
                <td className="p-3 text-right">×{r.k_quality}</td>
                <td className="p-3 text-right">{rub(r.conv_bonus)}</td>
                <td className="p-3 text-right">{rub(r.discount_bonus)}</td>
                <td className="p-3 text-right">×{r.k_team}</td>
                <td className="p-3 text-right">{rub(r.duty_pay)}</td>
                <td className="p-3 text-right font-semibold">{rub(r.total)}</td>
            </tr>
            {expanded && (
                <tr className="border-t bg-muted/20">
                    <td></td>
                    <td colSpan={9} className="p-4">
                        <div className="grid gap-3 md:grid-cols-3 text-xs">
                            <div>
                                <div className="mb-1 font-semibold">Засчитанные заявки</div>
                                <div>Новых: {b.counts?.new ?? 0} × {rub(b.rates?.new ?? 0)}</div>
                                <div>Постоянных: {b.counts?.permanent ?? 0} × {rub(b.rates?.permanent ?? 0)}</div>
                                <div>Печь/ВТО: {b.counts?.pech_vto ?? 0} × {rub(b.rates?.pech_vto ?? 0)}</div>
                                <div className="mt-1 text-muted-foreground">Заказы: {(b.countedOrderIds ?? []).join(', ') || '—'}</div>
                            </div>
                            <div>
                                <div className="mb-1 font-semibold">Качество и конверсия</div>
                                <div>Скоринг ОКК (avg): {b.qualityScore != null ? Math.round(b.qualityScore) : '—'} → К_кач ×{r.k_quality}</div>
                                <div>Конверсия: {b.conversionNumerator}/{b.conversionDenominator} = {b.conversionPct}% {b.conversionEligible ? '' : '(нет допуска)'}</div>
                                <div>Конв-бонус: {rub(r.conv_bonus)}</div>
                            </div>
                            <div>
                                <div className="mb-1 font-semibold">Скидка и маржа</div>
                                <div>Метрика «{b.discountMetric}»: {b.discountValue != null ? b.discountValue + '%' : '—'}</div>
                                <div>Бонус: {b.discountPassed ? rub(r.discount_bonus) : '0 (порог не пройден)'}</div>
                                <div>Маржа (аналитика): {rub(r.margin_info)}</div>
                                <div className="mt-1 text-muted-foreground">Оклад: {Math.round((b.okladProration ?? 1) * 100)}% · переменная часть {rub(b.variablePart ?? 0)}</div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
