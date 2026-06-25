'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import { CountedOrdersSplit, MetricDrilldownPanel, type DrilldownMetric } from '@/components/salary/salary-drilldowns';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

export default function MySalaryPage() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [row, setRow] = useState<any>(null);
    const [status, setStatus] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const { toast } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/salary/my?period=${year}-${month}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setRow(json.rows?.[0] ?? null);
            setStatus(json.period?.status ?? 'none');
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [year, month, toast]);

    useEffect(() => { load(); }, [load]);

    const b = row?.breakdown || {};
    const period = `${year}-${month}`;
    const managerId = row?.manager_id;
    const countedOrders: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];

    return (
        <div className="mx-auto max-w-3xl space-y-3 p-3">
            <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">Моя зарплата</h1>
                <div className="ml-auto flex gap-2">
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !row ? (
                <div className="border border-dashed p-12 text-center text-muted-foreground">
                    За {MONTHS[month - 1]} {year} расчёта пока нет.
                </div>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-baseline justify-between">
                            <span>{MONTHS[month - 1]} {year}</span>
                            <span className="text-2xl">{rub(row.total)}</span>
                        </CardTitle>
                        {status === 'closed' && <span className="text-xs text-muted-foreground">Период закрыт (выплачено)</span>}
                    </CardHeader>
                    <CardContent>
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
                                <MetricLine
                                    label="Конв-бонус" value={rub(row.conv_bonus)} sub={`конверсия ${b.conversionPct ?? 0}%`}
                                    metric="conversion" period={period} managerId={managerId} localOrders={countedOrders}
                                    expanded={expanded === 'conv_bonus'} onToggle={() => setExpanded(expanded === 'conv_bonus' ? null : 'conv_bonus')}
                                    onOpenOrder={setSelectedOrderId}
                                />
                                <Line label="Бонус за скидочную дисциплину" value={rub(row.discount_bonus)} sub={b.discountValue != null ? `скидка ${b.discountValue}%` : undefined} />
                                <Line label="Дежурства" value={rub(row.duty_pay)} />
                                <MetricLine
                                    label="К_команды (множитель переменной части)" value={`× ${row.k_team}`}
                                    metric="team" period={period} managerId={managerId} localOrders={countedOrders}
                                    expanded={expanded === 'k_team'} onToggle={() => setExpanded(expanded === 'k_team' ? null : 'k_team')}
                                    onOpenOrder={setSelectedOrderId}
                                />
                                <tr className="border-t-2 font-semibold">
                                    <td className="py-2">Итого к выплате</td>
                                    <td className="py-2 text-right text-lg">{rub(row.total)}</td>
                                </tr>
                            </tbody>
                        </table>

                        {(() => {
                            const ids: number[] = Array.isArray(b.countedOrderIds) ? b.countedOrderIds : [];
                            if (countedOrders.length === 0 && ids.length === 0) return null;
                            const totalCounted = (b.counts?.new ?? 0) + (b.counts?.permanent ?? 0);
                            return (
                                <div className="mt-4 border-t pt-3">
                                    <div className="mb-2 text-sm font-semibold">Засчитанные заказы ({totalCounted || countedOrders.length || ids.length})</div>
                                    <CountedOrdersSplit orders={countedOrders} fallbackIds={ids} onOpenOrder={setSelectedOrderId} />
                                    <div className="mt-2 text-[11px] text-muted-foreground">
                                        Нажмите на номер заказа, чтобы открыть карточку в ОКК и проверить данные расчёта.
                                    </div>
                                </div>
                            );
                        })()}
                    </CardContent>
                </Card>
            )}

            {selectedOrderId != null && (
                <OrderDetailsModal orderId={selectedOrderId} isOpen={selectedOrderId != null} onClose={() => setSelectedOrderId(null)} />
            )}
        </div>
    );
}

function Line({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <tr className="border-t">
            <td className="py-2">
                {label}
                {sub && <span className="ml-2 text-xs text-muted-foreground">{sub}</span>}
            </td>
            <td className="py-2 text-right">{value}</td>
        </tr>
    );
}

// Строка показателя с раскрытием заказов, на которых он построен (конверсия, К_команды).
function MetricLine({
    label, value, sub, metric, period, managerId, localOrders, expanded, onToggle, onOpenOrder,
}: {
    label: string;
    value: string;
    sub?: string;
    metric: DrilldownMetric;
    period: string;
    managerId: number;
    localOrders: any[];
    expanded: boolean;
    onToggle: () => void;
    onOpenOrder: (id: number) => void;
}) {
    return (
        <>
            <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={onToggle} title="Показать заказы, на которых построен показатель">
                <td className="py-2">
                    <span className="inline-flex items-baseline gap-1">
                        {expanded ? <ChevronDown className="h-3.5 w-3.5 self-center text-blue-600" /> : <ChevronRight className="h-3.5 w-3.5 self-center text-blue-600" />}
                        <span className="font-medium text-blue-700">{label}</span>
                        {sub && <span className="ml-2 text-xs text-muted-foreground">{sub}</span>}
                    </span>
                </td>
                <td className="py-2 text-right">{value}</td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={2} className="pb-2">
                        <MetricDrilldownPanel period={period} managerId={managerId} metric={metric} localOrders={localOrders} onOpenOrder={onOpenOrder} />
                    </td>
                </tr>
            )}
        </>
    );
}
