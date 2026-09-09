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

// Тип заявки + сколько заказов клиента дошло до «Передано в производство» (основа
// классификации) и порог. Пишем в КАЖДОЙ строке, чтобы было понятно, почему новый/постоянный.
// Эти же данные видны в карточке заказа в RetailCRM (история клиента).
const orderTypeLabel = (o: any, threshold?: number | null) => {
    const base = ORDER_TYPE_LABEL[o?.type] ?? '—';
    const deals = typeof o?.deals === 'number' ? o.deals : null;
    const dealsTxt = deals != null ? `${deals} ${pluralRu(deals, 'сделка', 'сделки', 'сделок')} в произв.` : null;
    const thr = typeof threshold === 'number' ? threshold : null;
    if (o?.type === 'permanent') {
        return dealsTxt ? `${base} · ${dealsTxt}` : base;
    }
    // Новый: показываем сколько сделок и сколько нужно, чтобы стать постоянным.
    if (dealsTxt && thr != null) return `${base} · ${dealsTxt} (постоянный при >${thr})`;
    if (dealsTxt) return `${base} · ${dealsTxt}`;
    return base;
};

const orderTypeTitle = (o: any, threshold?: number | null) => {
    const deals = typeof o?.deals === 'number' ? o.deals : null;
    const thr = typeof threshold === 'number' ? threshold : null;
    if (deals == null) return undefined;
    const need = thr != null ? ` Постоянный — более ${thr} таких сделок.` : '';
    return `Заказов клиента, доведённых до «Передано в производство»: ${deals}.${need} Считается по истории клиента, а не по полю «Способ» в RetailCRM.`;
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
};

// База RetailCRM (инстанс zmktlt.retailcrm.ru, см. lib/retailcrm/README.md). id заказа
// в нашей БД = внутренний id RetailCRM (raw_payload.id), по нему и строится /edit-ссылка.
const CRM_BASE = 'https://zmktlt.retailcrm.ru';

// Кликабельный номер заказа — открывает карточку заказа в RetailCRM (в новой вкладке).
function OrderLink({ id }: { id: number }) {
    return (
        <a
            href={`${CRM_BASE}/orders/${id}/edit`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 hover:underline"
            title="Открыть карточку заказа в RetailCRM"
        >
            Заказ #{id}
        </a>
    );
}

// ── Засчитанные заказы: две таблицы (Постоянные / Новые) ────────────────────
export function CountedOrdersSplit({
    orders,
    fallbackIds,
    permanentThreshold,
}: {
    orders: any[];
    fallbackIds?: number[];
    permanentThreshold?: number | null;
}) {
    const hasDetails = Array.isArray(orders) && orders.length > 0;
    const ids = fallbackIds ?? [];

    // Фолбэк для старых расчётов без детализации — показываем хотя бы номера.
    if (!hasDetails) {
        if (ids.length === 0) return <div className="text-xs text-muted-foreground">—</div>;
        return (
            <div className="flex flex-wrap gap-2">
                {ids.map((id) => (
                    <OrderLink key={id} id={id} />
                ))}
            </div>
        );
    }

    const permanent = orders.filter((o) => o.type === 'permanent');
    const fresh = orders.filter((o) => o.type !== 'permanent');

    return (
        <div className="space-y-3">
            <OrdersTypeTable title="Постоянные клиенты" rows={permanent} threshold={permanentThreshold} />
            <OrdersTypeTable title="Новые клиенты" rows={fresh} threshold={permanentThreshold} />
        </div>
    );
}

function OrdersTypeTable({ title, rows, threshold }: { title: string; rows: any[]; threshold?: number | null }) {
    const sum = rows.reduce((s, o) => s + (Number(o.sum) || 0), 0);
    const sumNoVat = rows.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);
    return (
        <div>
            <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold">{title} ({rows.length})</span>
                {rows.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                        на сумму {rub(sum)} с НДС · {rub(sumNoVat)} без НДС
                    </span>
                )}
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
                                <th className="px-2 py-1.5 text-right">Сумма с НДС</th>
                                <th className="px-2 py-1.5 text-right">Сумма без НДС</th>
                                <th className="px-2 py-1.5 text-right">Скидка</th>
                                <th className="px-2 py-1.5">Передан в произв.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((o) => (
                                <tr key={o.id} className="border-t">
                                    <td className="px-2 py-1.5"><OrderLink id={o.id} /></td>
                                    <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                    <td className="px-2 py-1.5" title={orderTypeTitle(o, threshold)}>{orderTypeLabel(o, threshold)}</td>
                                    <td className="px-2 py-1.5 text-right">{o.sum != null ? rub(o.sum) : '—'}</td>
                                    <td className="px-2 py-1.5 text-right">{o.revenueNoVat != null ? rub(o.revenueNoVat) : '—'}</td>
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
}: {
    orders: any[];
    countedIds: number[];
    numerator: number;
}) {
    const soldSet = new Set((countedIds ?? []).map(Number));
    const rows = (orders ?? []).map((o) => ({ ...o, sold: soldSet.has(Number(o.id)) }));
    const soldWithin = rows.filter((o) => o.sold).length;
    // Правомочные дубли на тендер исключены из знаменателя конверсии.
    const excludedCount = rows.filter((o) => o.excluded).length;
    const denominator = rows.length - excludedCount; // что реально в знаменателе

    if (rows.length === 0) {
        return <div className="border border-dashed px-2 py-2 text-[11px] text-muted-foreground">Поступивших заявок за месяц нет.</div>;
    }

    return (
        <div>
            <div className="mb-1.5 text-[11px] text-muted-foreground">
                В знаменателе конверсии: <b className="text-foreground">{denominator}</b>
                {excludedCount > 0 && (
                    <> · исключено дублей на тендер: <b className="text-foreground">{excludedCount}</b></>
                )}{' '}
                · из них продано (передано в производство): <b className="text-foreground">{soldWithin}</b>
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
                            <th className="px-2 py-1.5">Примечание</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((o) => {
                            // Правомочный дубль — приглушаем (исключён); фиктивный — подсвечиваем красным.
                            const rowCls = o.excluded
                                ? 'bg-muted/30 text-muted-foreground'
                                : o.dupNote
                                  ? 'bg-red-50'
                                  : o.sold
                                    ? 'bg-green-50'
                                    : '';
                            return (
                                <tr key={o.id} className={`border-t ${rowCls}`}>
                                    <td className="px-2 py-1.5"><OrderLink id={o.id} /></td>
                                    <td className="px-2 py-1.5">{o.clientName || '—'}</td>
                                    <td className="px-2 py-1.5">{o.source || '—'}</td>
                                    <td className="px-2 py-1.5">{fmtDate(o.createdAt)}</td>
                                    <td className="px-2 py-1.5 text-right">{rub(o.sum)}</td>
                                    <td className="px-2 py-1.5 text-center">
                                        {o.sold ? <Check className="mx-auto h-3.5 w-3.5 text-green-600" /> : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {o.dupNote ? (
                                            <span className={o.excluded ? 'text-muted-foreground' : 'font-medium text-red-700'}>
                                                {o.dupNote}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
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
}: {
    orders: any[];
    teamRevenueNoVat: number;
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
                                <td className="px-2 py-1.5"><OrderLink id={o.id} /></td>
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
