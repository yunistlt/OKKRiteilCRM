'use client';

import { Check } from 'lucide-react';

// ============================================================================
// Расшифровка показателей расчётной ведомости заказами — общий код для админского
// отчёта (/salary) и личного кабинета (/salary/my). Таблицы всегда открыты, данные
// приходят вместе с отчётом (см. lib/salary/report-details.ts) — без дозапросов.
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

// ── Конверсия: поступившие заявки месяца + отметка «продан» ──────────────────
// orders — IncomingOrderBrief[] (из отчёта). countedIds — id засчитанных заказов
// менеджера (breakdown.countedOrderIds): по ним ставим «продан». numerator —
// числитель конверсии (всего засчитано за месяц), для честной сноски.
export function ConversionOrdersTable({
    orders,
    countedIds,
    numerator,
    onOpenOrder,
}: {
    orders: any[];
    countedIds: number[];
    numerator: number;
    onOpenOrder: (id: number) => void;
}) {
    const soldSet = new Set((countedIds ?? []).map(Number));
    const rows = (orders ?? []).map((o) => ({ ...o, sold: soldSet.has(Number(o.id)) }));
    const soldWithin = rows.filter((o) => o.sold).length;

    if (rows.length === 0) {
        return <div className="border border-dashed px-2 py-2 text-[11px] text-muted-foreground">Поступивших заявок за месяц нет.</div>;
    }

    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                Поступило заявок: <b className="text-foreground">{rows.length}</b> · из них продано (передано в производство):{' '}
                <b className="text-foreground">{soldWithin}</b>
            </div>
            <div className="overflow-x-auto border">
                <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
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
                        {rows.map((o) => (
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
            {Number(numerator) !== soldWithin && (
                <div className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                    Числитель конверсии — все засчитанные за месяц заказы ({numerator}). В нём могут быть заказы,
                    поступившие в прошлые месяцы, поэтому отмеченных «продан» среди поступивших ({soldWithin}) может быть меньше.
                </div>
            )}
        </div>
    );
}

// ── К_команды: все засчитанные заказы отдела (из чего сложилась выручка отдела) ─
export function TeamOrdersTable({
    orders,
    teamRevenueNoVat,
    onOpenOrder,
}: {
    orders: any[];
    teamRevenueNoVat: number;
    onOpenOrder: (id: number) => void;
}) {
    const rows = orders ?? [];
    if (rows.length === 0) {
        return <div className="border border-dashed px-2 py-2 text-[11px] text-muted-foreground">Засчитанных заказов отдела нет.</div>;
    }
    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                Заказов отдела: <b className="text-foreground">{rows.length}</b> · выручка отдела (без НДС):{' '}
                <b className="text-foreground">{rub(teamRevenueNoVat)}</b>
            </div>
            <div className="max-h-96 overflow-auto border">
                <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
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
                        {rows.map((o) => (
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
