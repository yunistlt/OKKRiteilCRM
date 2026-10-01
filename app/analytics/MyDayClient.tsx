'use client';

/**
 * «Мой день» — рабочий стол менеджера.
 *
 * Экран отвечает не на вопрос «как у меня дела», а на вопрос «что сделать
 * сейчас»: одно главное действие крупно, под ним очередь следующих, справа —
 * план, воронка и показатели как ориентир (требование владельца 01.10.2026).
 *
 * Очередь считает система: приоритет зависит от суммы сделки, срочности,
 * обещания клиенту и времени без контакта, а не от того, когда задачу завели.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatRub } from '@/lib/format';

type Action = {
    orderId: number;
    orderNumber: string;
    client: string;
    amount: number;
    statusName: string;
    action: string;
    reason: string;
    kind: 'lead' | 'promise' | 'plan' | 'stale';
    advice: { action: string; why: string | null; offer: string | null } | null;
    weight: number;
    slaLeftMinutes: number | null;
    done: boolean;
};

type MyDay = {
    date: string;
    managerId: number | null;
    now: Action | null;
    next: Action[];
    all: Action[];
    counts: { urgent: number; next: number; planned: number; total: number; done: number };
    plan: { target: number; fact: number; forecast: number; factPct: number; forecastPct: number; workdaysLeft: number; perDay: number };
    funnel: Array<{ name: string; color: string | null; count: number; amount: number }>;
    metrics: { callsToday: number; talksToday: number; ordersMonth: number; revenueMonth: number };
};

const KIND_LABEL: Record<Action['kind'], string> = {
    lead: 'Новая заявка',
    promise: 'Обещание клиенту',
    plan: 'План дня',
    stale: 'Нет движения',
};

const KIND_STYLE: Record<Action['kind'], string> = {
    lead: 'bg-red-50 text-red-700',
    promise: 'bg-amber-50 text-amber-800',
    plan: 'bg-blue-50 text-blue-700',
    stale: 'bg-gray-100 text-gray-700',
};

export default function MyDayClient() {
    const [day, setDay] = useState<MyDay | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/analytics/my-day');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'День не собрался');
            setDay(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'День не собрался');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return <p className="px-6 py-8 text-sm text-gray-500">Собираем ваш день…</p>;
    }

    if (error) {
        return <p className="px-6 py-8 text-sm text-amber-800">{error}</p>;
    }

    if (!day?.managerId) {
        return (
            <div className="px-6 py-8">
                <h1 className="text-2xl font-bold text-gray-900">Мой день</h1>
                <p className="mt-2 text-sm text-gray-600">
                    К вашей учётной записи не привязан менеджер RetailCRM, поэтому личной очереди нет.
                    Отдел целиком — в разделах «Заказы» и «Контроль качества».
                </p>
            </div>
        );
    }

    const shown = showAll ? day.all : day.all.slice(0, 7);

    return (
        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-4">
                <NowCard action={day.now} />
                <NextQueue actions={day.next} />
                <TaskTable actions={shown} counts={day.counts} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
            </div>

            <div className="space-y-4">
                <PlanCard plan={day.plan} />
                <FunnelCard funnel={day.funnel} />
                <MetricsCard metrics={day.metrics} counts={day.counts} />
            </div>
        </div>
    );
}

function NowCard({ action }: { action: Action | null }) {
    if (!action) {
        return (
            <section className="border border-green-200 bg-green-50 p-5">
                <p className="text-[11px] font-black uppercase tracking-widest text-green-700">Сейчас</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900">Срочного нет — очередь разобрана</h2>
                <p className="mt-1 text-sm text-gray-700">
                    Можно взять холодную базу или разобрать архив: в разделе «Заказы» отфильтруйте нужный этап.
                </p>
            </section>
        );
    }

    return (
        <section className="border border-red-200 bg-red-50 p-5">
            <div className="flex flex-wrap items-center gap-2">
                <span className="bg-red-600 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white">Сейчас</span>
                <span className="bg-white px-3 py-1 text-[11px] font-bold text-red-700">Приоритет №1</span>
                {action.slaLeftMinutes !== null && (
                    <span className="bg-white px-3 py-1 text-[11px] font-bold text-red-700">
                        {action.slaLeftMinutes > 0 ? `Осталось ${action.slaLeftMinutes} мин` : 'Срок ответа вышел'}
                    </span>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-gray-900">{action.action}</h2>
                    <p className="mt-1 truncate text-base font-semibold text-gray-900" title={action.client}>
                        {action.client}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-700">{action.reason}</p>

                    {/* Совет готовит ИИ бота-РОПа — те же слова, что в чате с Семёном. */}
                    {action.advice && (
                        <div className="mt-2 border-l-2 border-red-300 pl-3">
                            <p className="text-sm font-semibold text-gray-900">{action.advice.action}</p>
                            {action.advice.why && <p className="mt-0.5 text-xs text-gray-600">Почему: {action.advice.why}</p>}
                            {action.advice.offer && <p className="text-xs text-gray-600">Узнать: {action.advice.offer}</p>}
                        </div>
                    )}
                </div>

                <div className="shrink-0 text-right">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Сумма заказа</p>
                    <p className="text-2xl font-bold tabular-nums text-gray-900">{formatRub(action.amount)}</p>
                    <Link
                        href={`/orders?number=${encodeURIComponent(action.orderNumber)}`}
                        className="mt-2 inline-block bg-gray-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600"
                    >
                        Открыть заказ №{action.orderNumber}
                    </Link>
                </div>
            </div>
        </section>
    );
}

function NextQueue({ actions }: { actions: Action[] }) {
    if (actions.length === 0) return null;

    return (
        <section>
            <div className="mb-2 flex items-baseline gap-3">
                <h3 className="text-base font-bold text-gray-900">Дальше</h3>
                <p className="text-xs text-gray-500">Очередь выстроена системой: деньги, срочность и обещания клиенту</p>
            </div>

            {/* По две карточки в ряд: правая колонка с планом съедает ширину, и
                по четыре суммы ломались на две строки. */}
            <div className="grid gap-3 sm:grid-cols-2">
                {actions.map((action, index) => (
                    <article key={action.orderNumber} className="flex flex-col border border-gray-200 bg-white p-3">
                        <div className="mb-1 flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center bg-gray-900 text-[11px] font-bold text-white">
                                {index + 2}
                            </span>
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_STYLE[action.kind]}`}>
                                {KIND_LABEL[action.kind]}
                            </span>
                        </div>

                        <p className="truncate text-sm font-bold text-gray-900" title={action.client}>{action.client}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600">{action.reason}</p>
                        {action.advice && (
                            <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-gray-900">
                                {action.advice.action}
                            </p>
                        )}
                        <p className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">{formatRub(action.amount)}</p>

                        <Link
                            href={`/orders?number=${encodeURIComponent(action.orderNumber)}`}
                            className="mt-2 border border-gray-300 px-2 py-1.5 text-center text-xs font-bold text-gray-800 hover:bg-gray-900 hover:text-white"
                        >
                            {action.action}
                        </Link>
                    </article>
                ))}
            </div>
        </section>
    );
}

function TaskTable({
    actions,
    counts,
    showAll,
    onToggle,
}: {
    actions: Action[];
    counts: MyDay['counts'];
    showAll: boolean;
    onToggle: () => void;
}) {
    return (
        <section className="border border-gray-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-bold text-gray-900">Сегодня</span>
                    <span className="text-red-700">🔴 {counts.urgent} срочных</span>
                    <span className="text-amber-700">🟡 {counts.next} следующих</span>
                    <span className="text-gray-600">⚪ {counts.planned} плановых</span>
                    {counts.done > 0 && <span className="text-green-700">✓ {counts.done} отработано</span>}
                </div>
                <button
                    type="button"
                    onClick={onToggle}
                    className="border border-gray-300 px-3 py-1 text-xs font-bold text-gray-800 hover:bg-gray-900 hover:text-white"
                >
                    {showAll ? 'Показать главное' : `Показать все ${counts.total}`}
                </button>
            </header>

            {actions.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-600">На сегодня действий нет.</p>
            ) : (
                <table className="w-full text-left text-[13px]">
                    <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                            <th className="px-3 py-2">Что сделать</th>
                            <th className="px-3 py-2">Клиент</th>
                            <th className="px-3 py-2">Сумма</th>
                            <th className="px-3 py-2">Почему сейчас</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {actions.map((action) => (
                            <tr key={action.orderNumber} className={`border-b border-gray-100 ${action.done ? 'bg-green-50/50' : ''}`}>
                                <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_STYLE[action.kind]}`}>
                                        {action.action}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-gray-900">{action.client}</td>
                                <td className="px-3 py-2 tabular-nums text-gray-900">{formatRub(action.amount)}</td>
                                <td className="px-3 py-2 text-gray-600">{action.reason}</td>
                                <td className="px-3 py-2 text-right">
                                    <Link
                                        href={`/orders?number=${encodeURIComponent(action.orderNumber)}`}
                                        className="text-xs font-bold text-blue-700 hover:underline"
                                    >
                                        №{action.orderNumber}
                                    </Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function PlanCard({ plan }: { plan: MyDay['plan'] }) {
    if (!plan.target) {
        return (
            <section className="border border-gray-200 bg-white p-3">
                <h3 className="text-sm font-bold text-gray-900">Мой план на месяц</h3>
                <p className="mt-1 text-xs text-gray-600">
                    План на этот месяц не заведён — его ставят в «Настройках мотивации».
                </p>
            </section>
        );
    }

    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Мой план на месяц</h3>

            <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                    <p className="text-sm font-bold tabular-nums text-gray-900">{formatRub(plan.target)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">План</p>
                </div>
                <div>
                    <p className="text-sm font-bold tabular-nums text-green-700">{formatRub(plan.fact)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Факт · {plan.factPct}%</p>
                </div>
                <div>
                    <p className="text-sm font-bold tabular-nums text-blue-700">{formatRub(plan.forecast)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Прогноз · {plan.forecastPct}%</p>
                </div>
            </div>

            <div className="mt-2 h-2 w-full bg-gray-100">
                <div
                    className={`h-2 ${plan.factPct >= 100 ? 'bg-green-600' : plan.factPct >= 70 ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, plan.factPct)}%` }}
                />
            </div>

            <p className="mt-2 text-xs text-gray-600">
                До конца месяца: <b className="text-gray-900">{plan.workdaysLeft}</b> рабочих дн. ·
                нужно в день <b className="text-gray-900">{formatRub(plan.perDay)}</b>
            </p>
        </section>
    );
}

function FunnelCard({ funnel }: { funnel: MyDay['funnel'] }) {
    if (funnel.length === 0) {
        return null;
    }

    const max = Math.max(...funnel.map((f) => f.count), 1);

    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Моя воронка за месяц</h3>
            <ul className="space-y-1.5">
                {funnel.map((stage) => (
                    <li key={stage.name}>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-gray-800" title={stage.name}>{stage.name}</span>
                            <span className="shrink-0 tabular-nums text-gray-500">
                                {stage.count} · {formatRub(stage.amount)}
                            </span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full bg-gray-100">
                            <div
                                className="h-1.5"
                                style={{ width: `${Math.max(4, (stage.count / max) * 100)}%`, backgroundColor: stage.color || '#94a3b8' }}
                            />
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function MetricsCard({ metrics, counts }: { metrics: MyDay['metrics']; counts: MyDay['counts'] }) {
    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Мои показатели</h3>
            <dl className="grid grid-cols-2 gap-2 text-center">
                <Metric label="Звонки сегодня" value={String(metrics.callsToday)} />
                <Metric label="Из них разговоры" value={String(metrics.talksToday)} />
                <Metric label="Заявки за месяц" value={String(metrics.ordersMonth)} />
                <Metric label="Отработано задач" value={`${counts.done} из ${counts.total}`} />
            </dl>
            <p className="mt-2 text-[11px] leading-snug text-gray-500">
                Разговором считается состоявшийся звонок дольше 20 секунд: гудки и автоответчик работой не считаются.
            </p>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-gray-100 bg-gray-50 px-2 py-1.5">
            <dd className="text-lg font-bold tabular-nums text-gray-900">{value}</dd>
            <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
        </div>
    );
}
