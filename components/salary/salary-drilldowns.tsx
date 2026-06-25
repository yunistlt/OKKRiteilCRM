'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';

// ============================================================================
// Расшифровка показателей расчётной ведомости заказами — общий код для админского
// отчёта (/salary) и личного кабинета (/salary/my). Цель: менеджер видит, на каких
// именно заказах построен каждый показатель его зарплаты.
// ============================================================================

const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const ORDER_TYPE_LABEL: Record<string, string> = { new: 'Новый', permanent: 'Постоянный' };

const pluralRu = (n: number, one: string, few: string, many: string) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
};

// Тип заявки + (для постоянных) сколько закрытых сделок у клиента за всё время.
const orderTypeLabel = (o: any) => {
    const base = ORDER_TYPE_LABEL[o?.type] ?? '—';
    if (o?.type === 'permanent' && typeof o?.deals === 'number' && o.deals > 0) {
        return `${base} · ${o.deals} ${pluralRu(o.deals, 'сделка', 'сделки', 'сделок')}`;
    }
    return base;
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
};

// Какой показатель раскрывается заказами и каким способом данные подгружаются.
// 'conversion'/'team' — ленивый API; 'plan' — из уже посчитанных засчитанных заказов.
export type DrilldownMetric = 'conversion' | 'team' | 'plan';
export function metricForBlockCode(code?: string): DrilldownMetric | null {
    switch (code) {
        case 'conv_bonus':
            return 'conversion';
        case 'k_team':
        case 'department_plan_gate':
            return 'team';
        case 'plan_gate':
        case 'plan_attainment':
        case 'plan_accelerator':
            return 'plan';
        default:
            return null;
    }
}

// Кликабельный номер заказа — открывает карточку в ОКК для проверки данных расчёта.
function OrderLink({ id, onOpenOrder }: { id: number; onOpenOrder: (id: number) => void }) {
    return (
        <button
            onClick={() => onOpenOrder(id)}
            className="font-medium text-blue-700 hover:underline"
            title="Открыть карточку заказа в ОКК"
        >
            Заказ #{id}
        </button>
    );
}

// ── Засчитанные заказы: две таблицы (Постоянные / Новые) ────────────────────
export function CountedOrdersSplit({
    orders,
    fallbackIds,
    onOpenOrder,
}: {
    orders: any[];
    fallbackIds?: number[];
    onOpenOrder: (id: number) => void;
}) {
    const hasDetails = Array.isArray(orders) && orders.length > 0;
    const ids = fallbackIds ?? [];

    // Фолбэк для старых расчётов без детализации — показываем хотя бы номера.
    if (!hasDetails) {
        if (ids.length === 0) return <div className="text-xs text-muted-foreground">—</div>;
        return (
            <div className="flex flex-wrap gap-2">
                {ids.map((id) => (
                    <OrderLink key={id} id={id} onOpenOrder={onOpenOrder} />
                ))}
            </div>
        );
    }

    const permanent = orders.filter((o) => o.type === 'permanent');
    const fresh = orders.filter((o) => o.type !== 'permanent');

    return (
        <div className="space-y-3">
            <OrdersTypeTable title="Постоянные клиенты" rows={permanent} onOpenOrder={onOpenOrder} />
            <OrdersTypeTable title="Новые клиенты" rows={fresh} onOpenOrder={onOpenOrder} />
        </div>
    );
}

function OrdersTypeTable({ title, rows, onOpenOrder }: { title: string; rows: any[]; onOpenOrder: (id: number) => void }) {
    const sum = rows.reduce((s, o) => s + (Number(o.sum) || 0), 0);
    return (
        <div>
            <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold">{title} ({rows.length})</span>
                {rows.length > 0 && <span className="text-[11px] text-muted-foreground">на сумму {rub(sum)}</span>}
            </div>
            {rows.length === 0 ? (
                <div className="border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">нет заказов</div>
            ) : (
                <div className="overflow-x-auto border">
                    <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-left text-muted-foreground">
                            <tr>
                                <th className="px-2 py-1.5">№ заказа</th>
                                <th className="px-2 py-1.5">Клиент</th>
                                <th className="px-2 py-1.5">Тип</th>
                                <th className="px-2 py-1.5 text-right">Сумма</th>
                                <th className="px-2 py-1.5 text-right">Скидка</th>
                                <th className="px-2 py-1.5">Передан в произв.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((o) => (
                                <tr key={o.id} className="border-t">
                                    <td className="px-2 py-1.5"><OrderLink id={o.id} onOpenOrder={onOpenOrder} /></td>
                                    <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                    <td className="px-2 py-1.5">{orderTypeLabel(o)}</td>
                                    <td className="px-2 py-1.5 text-right">{o.sum != null ? rub(o.sum) : '—'}</td>
                                    <td className="px-2 py-1.5 text-right">{o.discountPct != null ? o.discountPct + '%' : '—'}</td>
                                    <td className="px-2 py-1.5">{fmtDate(o.enteredAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ── Панель раскрытия показателя заказами ─────────────────────────────────────
// conversion/team грузятся лениво по API; plan строится из переданных засчитанных
// заказов (revenueNoVat = «Факт» по личному плану). Монтируется только при раскрытии.
export function MetricDrilldownPanel({
    period,
    managerId,
    metric,
    localOrders,
    onOpenOrder,
}: {
    period: string;
    managerId: number;
    metric: DrilldownMetric;
    localOrders?: any[]; // для metric='plan' — breakdown.countedOrders
    onOpenOrder: (id: number) => void;
}) {
    const [loading, setLoading] = useState(metric !== 'plan');
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (metric === 'plan') return; // данные уже есть локально
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/salary/drilldown?period=${period}&metric=${metric}&manager_id=${managerId}`, { signal: controller.signal });
                const json = await res.json().catch(() => ({ error: `Сервер вернул ${res.status}` }));
                if (!res.ok || json.error) throw new Error(json.error || `Ошибка ${res.status}`);
                setData(json);
            } catch (e: any) {
                setError(e.name === 'AbortError' ? 'Сервер не ответил за 20 с' : e.message);
            } finally {
                clearTimeout(timer);
                setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [period, managerId, metric]);

    const wrap = (children: React.ReactNode) => <div className="mt-1 border bg-white p-2">{children}</div>;

    if (loading) return wrap(<div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка заказов…</div>);
    if (error) return wrap(<div className="py-1 text-xs text-red-600">Не удалось загрузить: {error}</div>);

    if (metric === 'plan') return wrap(<PlanFactTable orders={localOrders ?? []} onOpenOrder={onOpenOrder} />);
    if (metric === 'conversion') return wrap(<ConversionTable data={data} onOpenOrder={onOpenOrder} />);
    return wrap(<TeamTable data={data} onOpenOrder={onOpenOrder} />);
}

// Конверсия: поступившие заявки + отметка «продан» (вошёл в засчитанные).
function ConversionTable({ data, onOpenOrder }: { data: any; onOpenOrder: (id: number) => void }) {
    const orders: any[] = Array.isArray(data?.orders) ? data.orders : [];
    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                Поступило заявок: <b className="text-foreground">{data?.incoming ?? orders.length}</b> · из них продано (передано в производство):{' '}
                <b className="text-foreground">{data?.soldWithinIncoming ?? 0}</b>
            </div>
            <div className="max-h-72 overflow-auto border">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5">№ заказа</th>
                            <th className="px-2 py-1.5">Клиент</th>
                            <th className="px-2 py-1.5">Источник</th>
                            <th className="px-2 py-1.5">Поступил</th>
                            <th className="px-2 py-1.5 text-right">Сумма</th>
                            <th className="px-2 py-1.5 text-center">Продан</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((o) => (
                            <tr key={o.id} className={`border-t ${o.sold ? 'bg-green-50' : ''}`}>
                                <td className="px-2 py-1.5"><OrderLink id={o.id} onOpenOrder={onOpenOrder} /></td>
                                <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                <td className="px-2 py-1.5">{o.source || '—'}</td>
                                <td className="px-2 py-1.5">{fmtDate(o.createdAt)}</td>
                                <td className="px-2 py-1.5 text-right">{rub(o.sum)}</td>
                                <td className="px-2 py-1.5 text-center">
                                    {o.sold ? <Check className="mx-auto h-3.5 w-3.5 text-green-600" /> : <span className="text-muted-foreground">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {Number(data?.numerator) !== Number(data?.soldWithinIncoming) && (
                <div className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                    Числитель конверсии — все засчитанные за месяц заказы ({data?.numerator}). В нём могут быть заказы,
                    поступившие в прошлые месяцы, поэтому отмеченных «продан» среди поступивших ({data?.soldWithinIncoming}) может быть меньше.
                </div>
            )}
        </div>
    );
}

// К_команды: все засчитанные заказы отдела (из чего сложилась выручка отдела).
function TeamTable({ data, onOpenOrder }: { data: any; onOpenOrder: (id: number) => void }) {
    const orders: any[] = Array.isArray(data?.orders) ? data.orders : [];
    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                Заказов отдела: <b className="text-foreground">{data?.count ?? orders.length}</b> · выручка отдела (без НДС):{' '}
                <b className="text-foreground">{rub(data?.teamRevenueNoVat ?? 0)}</b>
            </div>
            <div className="max-h-72 overflow-auto border">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5">№ заказа</th>
                            <th className="px-2 py-1.5">Менеджер</th>
                            <th className="px-2 py-1.5">Клиент</th>
                            <th className="px-2 py-1.5 text-right">Выручка б/НДС</th>
                            <th className="px-2 py-1.5 text-right">Сумма</th>
                            <th className="px-2 py-1.5">Передан в произв.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((o) => (
                            <tr key={o.id} className="border-t">
                                <td className="px-2 py-1.5"><OrderLink id={o.id} onOpenOrder={onOpenOrder} /></td>
                                <td className="px-2 py-1.5">{o.managerName}</td>
                                <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                <td className="px-2 py-1.5 text-right">{rub(o.revenueNoVat)}</td>
                                <td className="px-2 py-1.5 text-right">{rub(o.sum)}</td>
                                <td className="px-2 py-1.5">{fmtDate(o.enteredAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Гейт/план: засчитанные заказы менеджера, чья выручка без НДС складывается в «Факт».
function PlanFactTable({ orders, onOpenOrder }: { orders: any[]; onOpenOrder: (id: number) => void }) {
    const rows = [...orders].sort((a, b) => (Number(b.revenueNoVat) || 0) - (Number(a.revenueNoVat) || 0));
    const fact = rows.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);
    if (rows.length === 0) return <div className="py-1 text-xs text-muted-foreground">Засчитанных заказов нет.</div>;
    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                Факт (выручка без НДС) = <b className="text-foreground">{rub(fact)}</b> по {rows.length} {pluralRu(rows.length, 'заказу', 'заказам', 'заказам')}
            </div>
            <div className="max-h-72 overflow-auto border">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5">№ заказа</th>
                            <th className="px-2 py-1.5">Клиент</th>
                            <th className="px-2 py-1.5 text-right">Выручка б/НДС</th>
                            <th className="px-2 py-1.5 text-right">Сумма</th>
                            <th className="px-2 py-1.5">Передан в произв.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((o) => (
                            <tr key={o.id} className="border-t">
                                <td className="px-2 py-1.5"><OrderLink id={o.id} onOpenOrder={onOpenOrder} /></td>
                                <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                <td className="px-2 py-1.5 text-right">{o.revenueNoVat != null ? rub(o.revenueNoVat) : '—'}</td>
                                <td className="px-2 py-1.5 text-right">{o.sum != null ? rub(o.sum) : '—'}</td>
                                <td className="px-2 py-1.5">{fmtDate(o.enteredAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
