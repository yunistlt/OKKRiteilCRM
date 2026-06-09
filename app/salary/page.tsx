'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ChevronRight, CalendarClock, Settings, Download, Lock, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';
import DutyModal from './DutyModal';
import OrderDetailsModal from '@/components/OrderDetailsModal';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const ORDER_TYPE_LABEL: Record<string, string> = { new: 'Новый', permanent: 'Постоянный', pech_vto: 'Печь/ВТО' };
const fmtDate = (s?: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
};

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
    const [reportManager, setReportManager] = useState<CalcRow | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [dutyOpen, setDutyOpen] = useState(false);
    const { toast } = useToast();

    const period = `${year}-${month}`;
    const closed = data?.period?.status === 'closed';

    const fetchData = useCallback(async () => {
        setLoading(true);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000); // не висеть вечно
        try {
            const res = await fetch(`/api/salary?period=${period}`, { signal: controller.signal });
            const json = await res.json().catch(() => ({ error: `Сервер вернул ${res.status}` }));
            if (!res.ok || json.error) throw new Error(json.error || `Ошибка ${res.status}`);
            setData(json);
        } catch (e: any) {
            setData({ period: { year, month, status: 'error' }, rows: [], total: 0 });
            toast({
                title: 'Ошибка загрузки',
                description: e.name === 'AbortError' ? 'Сервер не ответил за 20 с (возможно, идёт деплой). Обновите страницу.' : e.message,
                variant: 'destructive',
            });
        } finally {
            clearTimeout(timer);
            setLoading(false);
        }
    }, [period, year, month, toast]);

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
        <div className="w-full space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">Зарплата ОП</h1>
                <div className="ml-auto flex items-center gap-2">
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 border border-input bg-background px-2 text-sm">
                        {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <Button variant="outline" size="sm" onClick={() => setDutyOpen(true)}>
                        <CalendarClock className="mr-2 h-4 w-4" /> Дежурства
                    </Button>
                    <Link href="/salary/settings">
                        <Button variant="outline" size="sm"><Settings className="mr-2 h-4 w-4" /> Настройки мотивации</Button>
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
                <span className={`px-2 py-0.5 text-xs ${closed ? 'bg-gray-200 text-gray-700' : data?.period?.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {closed ? 'закрыт' : data?.period?.status === 'open' ? 'открыт' : 'не рассчитан'}
                </span>
                {rows.length > 0 && <span className="ml-auto font-medium text-foreground">ФОТ отдела: {rub(data!.total)}</span>}
            </div>

            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : rows.length === 0 ? (
                <div className="border border-dashed p-12 text-center text-sm text-muted-foreground">
                    {data?.period?.status === 'open'
                        ? 'Период рассчитан, но засчитанных заявок нет — за месяц ни один заказ не дошёл до статуса «Передано в производство» (проверьте, что синхронизация истории RetailCRM актуальна).'
                        : data?.period?.status === 'error'
                            ? 'Не удалось загрузить данные. Обновите страницу или повторите позже.'
                            : 'Расчёта за этот период нет. Нажмите «Пересчитать».'}
                </div>
            ) : (
                <div className="overflow-x-auto border">
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
                                <RowGroup key={r.manager_id} r={r} onOpen={() => setReportManager(r)} />
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

            {reportManager && (
                <ManagerReportModal
                    r={reportManager}
                    monthLabel={`${MONTHS[month - 1]} ${year}`}
                    onClose={() => setReportManager(null)}
                    onOpenOrder={(id) => setSelectedOrderId(id)}
                />
            )}

            {selectedOrderId != null && (
                <OrderDetailsModal orderId={selectedOrderId} isOpen={selectedOrderId != null} onClose={() => setSelectedOrderId(null)} />
            )}
        </div>
    );
}

function RowGroup({ r, onOpen }: { r: CalcRow; onOpen: () => void }) {
    return (
        <tr className="cursor-pointer border-t hover:bg-muted/30" onClick={onOpen} title="Открыть подробный отчёт">
            <td className="p-3 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
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
    );
}

// Подробный отчёт по менеджеру в модалке. Номера заказов кликабельны и открывают
// карточку заказа в ОКК (OrderDetailsModal) — чтобы менеджер и РОП могли проверить
// каждую засчитанную заявку, на которой построен расчёт ЗП.
function ManagerReportModal({
    r,
    monthLabel,
    onClose,
    onOpenOrder,
}: {
    r: CalcRow;
    monthLabel: string;
    onClose: () => void;
    onOpenOrder: (orderId: number) => void;
}) {
    const b = r.breakdown || {};
    const details: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
    const orderIds: number[] = Array.isArray(b.countedOrderIds) ? b.countedOrderIds : [];
    // Фолбэк для старых расчётов без детализации: показываем хотя бы номера.
    const orderRows: any[] = details.length > 0 ? details : orderIds.map((id) => ({ id }));
    const totalCounted = (b.counts?.new ?? 0) + (b.counts?.permanent ?? 0) + (b.counts?.pech_vto ?? 0);

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden border border-border bg-white" onClick={(e) => e.stopPropagation()}>
                {/* Шапка */}
                <div className="flex items-center justify-between border-b p-4">
                    <div>
                        <div className="text-lg font-semibold text-gray-900">{r.manager_name}</div>
                        <div className="text-xs text-muted-foreground">Отчёт по зарплате · {monthLabel}</div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="text-xs text-muted-foreground">Итого к выплате</div>
                            <div className="text-xl font-semibold text-gray-900">{rub(r.total)}</div>
                        </div>
                        <button onClick={onClose} className="p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Закрыть">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Тело (скролл) */}
                <div className="space-y-4 overflow-y-auto p-4 text-sm">
                    {/* Как сложилась сумма — по блокам назначенной схемы (фолбэк на legacy-поля) */}
                    <div className="border bg-muted/20 p-3 text-xs">
                        <div className="mb-2 flex items-center gap-2 font-semibold">
                            Как сложилась сумма
                            {b.schemeCode && <span className="bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">схема: {b.schemeCode}</span>}
                        </div>
                        {Array.isArray(b.blockContributions) && b.blockContributions.length > 0 ? (
                            <div className="space-y-1">
                                {b.blockContributions.map((c: any, i: number) => (
                                    <div key={i} className="flex items-baseline justify-between gap-3 border-b border-dashed py-0.5 last:border-0">
                                        <div>
                                            <span className="font-medium">{c.name}</span>
                                            <span className="ml-2 text-muted-foreground">{c.explain}</span>
                                            {c.dataFill && c.dataFill.pct < 1 && (
                                                <span className="ml-2 bg-amber-100 px-1 text-[10px] text-amber-700">данные {Math.round(c.dataFill.pct * 100)}%</span>
                                            )}
                                        </div>
                                        <div className="whitespace-nowrap font-medium">
                                            {c.kind === 'multiplier' ? `×${c.multiplier}` : rub(c.amount)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid gap-1 md:grid-cols-2">
                                <div>Оклад ({Math.round((b.okladProration ?? 1) * 100)}%): <b>{rub(r.oklad)}</b></div>
                                <div>Премия за заявки: {rub(r.premia_zayavki)} × К_кач {r.k_quality}</div>
                                <div>Конв-бонус: {rub(r.conv_bonus)}</div>
                                <div>Скидка-бонус: {rub(r.discount_bonus)}</div>
                                <div>Переменная часть × К_команды {r.k_team}: <b>{rub(b.variablePart ?? 0)}</b></div>
                                <div>Дежурства: {rub(r.duty_pay)}</div>
                            </div>
                        )}
                        <div className="mt-2 border-t pt-2 font-semibold">Итого: {rub(r.total)}</div>
                    </div>

                    {/* Три блока детализации */}
                    <div className="grid gap-3 text-xs md:grid-cols-3">
                        <div>
                            <div className="mb-1 font-semibold">Засчитанные заявки</div>
                            <div>Новых: {b.counts?.new ?? 0} × {rub(b.rates?.new ?? 0)}</div>
                            <div>Постоянных: {b.counts?.permanent ?? 0} × {rub(b.rates?.permanent ?? 0)}</div>
                            <div>Печь/ВТО: {b.counts?.pech_vto ?? 0} × {rub(b.rates?.pech_vto ?? 0)}</div>
                            <div className="mt-1 text-muted-foreground">Всего заказов: {totalCounted}</div>
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
                        </div>
                    </div>

                    {/* Засчитанные заказы — кликабельные номера + детали */}
                    <div>
                        <div className="mb-2 font-semibold">Засчитанные заказы ({orderRows.length})</div>
                        {orderRows.length > 0 ? (
                            <div className="overflow-x-auto border">
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/40 text-left text-muted-foreground">
                                        <tr>
                                            <th className="px-2 py-1.5">№ заказа</th>
                                            <th className="px-2 py-1.5">Тип</th>
                                            <th className="px-2 py-1.5 text-right">Сумма</th>
                                            <th className="px-2 py-1.5 text-right">Скидка</th>
                                            <th className="px-2 py-1.5">Передан в произв.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderRows.map((o) => (
                                            <tr key={o.id} className="border-t">
                                                <td className="px-2 py-1.5">
                                                    <button
                                                        onClick={() => onOpenOrder(o.id)}
                                                        className="font-medium text-blue-700 hover:underline"
                                                        title="Открыть карточку заказа в ОКК"
                                                    >
                                                        Заказ #{o.id}
                                                    </button>
                                                </td>
                                                <td className="px-2 py-1.5">{ORDER_TYPE_LABEL[o.type] ?? '—'}</td>
                                                <td className="px-2 py-1.5 text-right">{o.sum != null ? rub(o.sum) : '—'}</td>
                                                <td className="px-2 py-1.5 text-right">{o.discountPct != null ? o.discountPct + '%' : '—'}</td>
                                                <td className="px-2 py-1.5">{fmtDate(o.enteredAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground">—</div>
                        )}
                        <div className="mt-2 text-[11px] text-muted-foreground">
                            Нажмите на номер заказа, чтобы открыть карточку в ОКК и проверить данные.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
