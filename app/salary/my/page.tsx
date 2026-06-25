'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import ManagerSalarySimulatorModal from '../ManagerSalarySimulatorModal';
import { CountedOrdersSplit, ConversionOrdersTable, TeamOrdersTable } from '@/components/salary/salary-drilldowns';

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
    const [details, setDetails] = useState<any>(null);
    const [simOpen, setSimOpen] = useState(false);
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
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [year, month, toast]);

    useEffect(() => { load(); }, [load]);

    const b = row?.breakdown || {};
    const countedOrders: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
    const countedOrderIds: number[] = Array.isArray(b.countedOrderIds) ? b.countedOrderIds : [];
    const incoming: any[] = Array.isArray(details?.incoming) ? details.incoming : [];
    const teamOrders: any[] = Array.isArray(details?.teamOrders) ? details.teamOrders : [];
    const teamRevenueNoVat: number = details?.teamRevenueNoVat ?? 0;

    return (
        <div className="mx-auto max-w-3xl space-y-3 p-3">
            <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">Моя зарплата</h1>
                <div className="ml-auto flex items-center gap-2">
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
                                <Line label="Конв-бонус" value={rub(row.conv_bonus)} sub={`конверсия ${b.conversionPct ?? 0}%`} />
                                <Line label="Бонус за скидочную дисциплину" value={rub(row.discount_bonus)} sub={b.discountValue != null ? `скидка ${b.discountValue}%` : undefined} />
                                <Line label="Дежурства" value={rub(row.duty_pay)} />
                                <Line label="К_команды (множитель переменной части)" value={`× ${row.k_team}`} />
                                <tr className="border-t-2 font-semibold">
                                    <td className="py-2">Итого к выплате</td>
                                    <td className="py-2 text-right text-lg">{rub(row.total)}</td>
                                </tr>
                            </tbody>
                        </table>

                        {(countedOrders.length > 0 || countedOrderIds.length > 0) && (() => {
                            const totalCounted = (b.counts?.new ?? 0) + (b.counts?.permanent ?? 0);
                            return (
                                <div className="mt-4 border-t pt-3">
                                    <div className="mb-2 text-sm font-semibold">Засчитанные заказы ({totalCounted || countedOrders.length || countedOrderIds.length})</div>
                                    <CountedOrdersSplit orders={countedOrders} fallbackIds={countedOrderIds} onOpenOrder={setSelectedOrderId} />
                                </div>
                            );
                        })()}

                        {/* Конв-бонус: поступившие заявки месяца + отметка «продан» */}
                        <div className="mt-4 border-t pt-3">
                            <div className="mb-2 text-sm font-semibold">Конв-бонус — поступившие заявки</div>
                            <ConversionOrdersTable orders={incoming} countedIds={countedOrderIds} numerator={b.conversionNumerator ?? countedOrderIds.length} onOpenOrder={setSelectedOrderId} />
                        </div>

                        {/* К_команды: все засчитанные заказы отдела */}
                        <div className="mt-4 border-t pt-3">
                            <div className="mb-2 text-sm font-semibold">К_команды — заказы отдела</div>
                            <TeamOrdersTable orders={teamOrders} teamRevenueNoVat={teamRevenueNoVat} onOpenOrder={setSelectedOrderId} />
                        </div>

                        <div className="mt-2 text-[11px] text-muted-foreground">
                            Нажмите на номер заказа, чтобы открыть карточку в ОКК и проверить данные расчёта.
                        </div>
                    </CardContent>
                </Card>
            )}

            {selectedOrderId != null && (
                <OrderDetailsModal orderId={selectedOrderId} isOpen={selectedOrderId != null} onClose={() => setSelectedOrderId(null)} />
            )}

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
