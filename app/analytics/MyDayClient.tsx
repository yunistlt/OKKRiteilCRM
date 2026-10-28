'use client';

/**
 * «Мой день» — рабочий стол менеджера.
 *
 * Экран отвечает не на вопрос «как у меня дела», а на вопрос «что сделать
 * сейчас»: одно главное действие крупно, под ним очередь следующих, справа —
 * план, воронка, показатели и подсказка дня (требование владельца 01.10.2026,
 * вид по присланному образцу).
 *
 * Очередь считает система: приоритет зависит от суммы сделки, срочности,
 * обещания клиенту и времени без контакта, а не от того, когда задачу завели.
 *
 * День разделён на два блока (решение владельца 28.10.2026): сначала текущие
 * активные заявки — то, что уже в работе, и за ними поступившие сегодня, —
 * потом развитие клиента. Порядок задаёт сервер (`lib/analytics/my-day.ts`),
 * экран его только показывает: второй сортировки здесь нет.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import { Phone, Mail, ArrowRight, Flame, Clock, Lightbulb } from 'lucide-react';
import { formatRub } from '@/lib/format';

type Action = {
    orderId: number;
    orderNumber: string;
    client: string;
    amount: number;
    statusName: string;
    action: string;
    reason: string;
    kind: 'lead' | 'promise' | 'plan' | 'stale' | 'development';
    block: 'active' | 'development';
    advice: { action: string; why: string | null; offer: string | null } | null;
    weight: number;
    slaLeftMinutes: number | null;
    done: boolean;
    /** Чем задача закрыта сегодня: звонок, письмо, смена статуса… */
    doneBy?: string | null;
};

type MyDay = {
    date: string;
    managerId: number | null;
    now: Action | null;
    next: Action[];
    all: Action[];
    counts: { urgent: number; next: number; planned: number; development: number; total: number; done: number };
    plan: {
        target: number;
        fact: number;
        forecast: number;
        factPct: number;
        forecastPct: number;
        workdaysLeft: number;
        perDay: number;
        computedAt: string | null;
        soldOrders: number;
    };
    funnel: Array<{ name: string; color: string | null; count: number; amount: number }>;
    metrics: { callsToday: number; talksToday: number; ordersMonth: number; revenueMonth: number };
};

const KIND_LABEL: Record<Action['kind'], string> = {
    lead: 'Новый лид',
    promise: 'Обещание клиенту',
    plan: 'План дня',
    stale: 'Нет движения',
    development: 'Развитие клиента',
};

const KIND_STYLE: Record<Action['kind'], string> = {
    lead: 'bg-red-50 text-red-700',
    promise: 'bg-amber-50 text-amber-800',
    plan: 'bg-blue-50 text-blue-700',
    stale: 'bg-gray-100 text-gray-600',
    development: 'bg-green-50 text-green-800',
};

/** Шапки блоков дня — те же слова, что в утреннем письме бота. */
const BLOCKS: Array<{ key: Action['block']; title: string; hint: string }> = [
    { key: 'active', title: 'Текущие активные заявки', hint: 'заявки в работе, затем поступившие сегодня' },
    { key: 'development', title: 'Развитие клиента', hint: 'берём, когда по активным заявкам сделано' },
];

/** Вкладки списка — срезы той же очереди, как в образце. */
const TABS = [
    { key: 'all', label: 'Мои задачи' },
    { key: 'lead', label: 'Новые лиды' },
    { key: 'promise', label: 'Обещания клиенту' },
    { key: 'stale', label: 'Без движения' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function MyDayClient() {
    const [day, setDay] = useState<MyDay | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<TabKey>('all');
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

    /**
     * Выполненное из списка уходит.
     *
     * Ирина Гордеева 12.10.2026: «задачи не уходят, даже если выполнены, так и
     * висят списком на день». Показываем их отдельно — по кнопке, чтобы можно
     * было проверить, что день закрыт.
     */
    const [showDone, setShowDone] = useState(false);

    const rows = useMemo(() => {
        if (!day) return [];
        const byTab = tab === 'all' ? day.all : day.all.filter((a) => a.kind === tab);
        const filtered = showDone ? byTab.filter((a) => a.done) : byTab.filter((a) => !a.done);
        if (showAll) return filtered;
        // Короткий вид режет только активный блок: если резать список целиком,
        // развитие при восьми активных заявках не видно вовсе, а оно второй
        // блок дня, а не продолжение первого.
        const active = filtered.filter((a) => a.block === 'active').slice(0, 8);
        return [...active, ...filtered.filter((a) => a.block === 'development')];
    }, [day, tab, showAll, showDone]);

    if (loading) return <p className="px-6 py-8 text-sm text-gray-500">Собираем ваш день…</p>;
    if (error) return <p className="px-6 py-8 text-sm text-amber-800">{error}</p>;

    if (!day?.managerId) {
        return (
            <div className="px-6 py-8">
                <p className="text-sm text-gray-600">
                    К вашей учётной записи не привязан менеджер RetailCRM, поэтому личной очереди нет.
                    Работа отдела — в разделах «Заказы» и «Контроль качества».
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
                <NowCard action={day.now} />
                <NextQueue actions={day.next} />
                <TaskTable
                    rows={rows}
                    counts={day.counts}
                    day={day}
                    tab={tab}
                    onTab={(key) => { setTab(key); setShowAll(false); }}
                    showAll={showAll}
                    showDone={showDone}
                    onToggleDone={() => setShowDone((v) => !v)}
                    onToggle={() => setShowAll((v) => !v)}
                />
            </div>

            <div className="space-y-4">
                <PlanCard plan={day.plan} />
                <FunnelCard funnel={day.funnel} />
                <MetricsCard metrics={day.metrics} plan={day.plan} counts={day.counts} />
                <UpcomingCard actions={day.all} />
                <AssistantCard day={day} />
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
                <span className="flex items-center gap-1 bg-white px-3 py-1 text-[11px] font-bold text-red-700">
                    <Flame size={12} /> Приоритет №1
                </span>
                {action.slaLeftMinutes !== null && (
                    <span className="flex items-center gap-1 bg-white px-3 py-1 text-[11px] font-bold text-red-700">
                        <Clock size={12} />
                        {action.slaLeftMinutes > 0 ? `Осталось ${action.slaLeftMinutes} мин` : 'Срок ответа вышел'}
                    </span>
                )}
            </div>

            <h2 className="mt-3 text-2xl font-bold text-gray-900">{action.action} клиенту</h2>

            <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_190px_210px]">
                <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-gray-900" title={action.client}>{action.client}</p>
                    <p className="mt-0.5 text-sm text-gray-700">{action.reason}</p>
                    {action.statusName && (
                        <span className="mt-2 inline-block bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                            {action.statusName}
                        </span>
                    )}
                    {action.advice && (
                        <div className="mt-2 border-l-2 border-red-300 pl-3">
                            <p className="text-sm font-semibold text-gray-900">{action.advice.action}</p>
                            {action.advice.why && <p className="mt-0.5 text-xs text-gray-600">Почему: {action.advice.why}</p>}
                            {action.advice.offer && <p className="text-xs text-gray-600">Узнать: {action.advice.offer}</p>}
                        </div>
                    )}
                </div>

                <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Сделка</p>
                    <p className="text-2xl font-bold tabular-nums text-gray-900">{formatRub(action.amount)}</p>
                    <p className="mt-1 text-xs text-gray-600">
                        Заказ №<OrderNumberLink number={action.orderNumber} from="my-day" />
                    </p>
                </div>

                <div className="space-y-2">
                    <Link
                        href={`/orders?order=${action.orderId}&from=my-day`}
                        className="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
                    >
                        <Phone size={14} /> Позвонить
                    </Link>
                    <Link
                        href={`/orders?order=${action.orderId}&from=my-day`}
                        className="flex items-center justify-center gap-2 border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-900 hover:text-white"
                    >
                        <Mail size={14} /> Написать
                    </Link>
                    <Link
                        href={`/orders?order=${action.orderId}&from=my-day`}
                        className="flex items-center justify-center gap-2 border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-900 hover:text-white"
                    >
                        Открыть сделку <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </section>
    );
}

function NextQueue({ actions }: { actions: Action[] }) {
    if (actions.length === 0) return null;

    return (
        <section className="border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-lg font-bold text-gray-900">Далее</h3>
                <p className="text-xs text-gray-500">Система выбрала следующие действия по приоритету</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {actions.map((action, index) => (
                    <article key={action.orderNumber} className="flex flex-col border border-gray-200 p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center bg-gray-900 text-[11px] font-bold text-white">
                                {index + 2}
                            </span>
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_STYLE[action.kind]}`}>
                                {KIND_LABEL[action.kind]}
                            </span>
                            {action.slaLeftMinutes !== null && action.slaLeftMinutes > 0 && (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-red-600">
                                    <Clock size={10} /> {action.slaLeftMinutes} мин
                                </span>
                            )}
                        </div>

                        <p className="truncate text-sm font-bold text-gray-900" title={action.client}>{action.client}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600">{action.reason}</p>
                        {action.advice && (
                            <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-gray-900">
                                {action.advice.action}
                            </p>
                        )}
                        <p className="mt-auto whitespace-nowrap pt-2 text-base font-bold tabular-nums text-gray-900">
                            {formatRub(action.amount)}
                        </p>

                        <Link
                            href={`/orders?order=${action.orderId}&from=my-day`}
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
    rows,
    counts,
    day,
    tab,
    onTab,
    showAll,
    showDone,
    onToggleDone,
    onToggle,
}: {
    rows: Action[];
    counts: MyDay['counts'];
    day: MyDay;
    tab: TabKey;
    onTab: (key: TabKey) => void;
    showAll: boolean;
    showDone: boolean;
    onToggleDone: () => void;
    onToggle: () => void;
}) {
    // В счётчике вкладки — то, что осталось сделать, а не весь день.
    const countOf = (key: TabKey) => day.all.filter((a) => !a.done && (key === 'all' || a.kind === key)).length;

    // Оба блока в списке — значит их надо разделить шапками.
    const splitBlocks = new Set(rows.map((action) => action.block)).size > 1;

    return (
        <section className="border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-3 pt-2">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => onTab(item.key)}
                        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-sm font-bold ${
                            tab === item.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {item.label}
                        <span className={`px-1.5 text-[11px] ${tab === item.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                            {countOf(item.key)}
                        </span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold text-gray-900">Сегодня</span>
                    <span className="text-red-700">🔴 {counts.urgent} приоритетных</span>
                    <span className="text-amber-700">🟡 {counts.next} следующих</span>
                    <span className="text-gray-600">⚪ {counts.planned} плановых</span>
                    {counts.development > 0 && (
                        <span className="text-green-800">🟢 {counts.development} на развитие</span>
                    )}
                    {counts.done > 0 && (
                        <button
                            type="button"
                            onClick={onToggleDone}
                            className={`font-bold ${showDone ? 'text-gray-900 underline' : 'text-green-700 hover:underline'}`}
                        >
                            ✓ {counts.done} отработано{showDone ? ' — скрыть' : ''}
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onToggle}
                    className="border border-gray-300 px-3 py-1 text-xs font-bold text-gray-800 hover:bg-gray-900 hover:text-white"
                >
                    {showAll ? 'Показать главное' : `Показать все ${counts.total}`}
                </button>
            </div>

            {rows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-600">
                    {showDone ? 'Отработанных задач в этом срезе нет.' : 'Всё сделано — в этом срезе задач не осталось.'}
                </p>
            ) : (
                <table className="w-full text-left text-[13px]">
                    <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                            <th className="px-3 py-2">Приоритет</th>
                            <th className="px-3 py-2">Клиент / сделка</th>
                            <th className="px-3 py-2">Сумма</th>
                            <th className="px-3 py-2">Следующий шаг</th>
                            <th className="px-3 py-2">Почему сейчас</th>
                            <th className="px-3 py-2">Действие</th>
                        </tr>
                    </thead>
                    {BLOCKS.map((block) => {
                        const blockRows = rows.filter((action) => action.block === block.key);
                        if (blockRows.length === 0) return null;

                        return (
                            <tbody key={block.key}>
                                {/* Шапку блока рисуем только когда в списке оба:
                                    разделять один блок нечем, и строка станет шумом. */}
                                {splitBlocks && (
                                    <tr className="border-b border-gray-300 bg-gray-50">
                                        <td colSpan={6} className="px-3 py-1.5">
                                            <span className="text-[11px] font-black uppercase tracking-widest text-gray-900">
                                                {block.title}
                                            </span>
                                            <span className="ml-2 text-[11px] text-gray-500">
                                                {blockRows.length} · {block.hint}
                                            </span>
                                        </td>
                                    </tr>
                                )}
                                {blockRows.map((action) => (
                                    <tr key={action.orderNumber} className={`border-b border-gray-100 ${action.done ? 'bg-green-50/50' : ''}`}>
                                        <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_STYLE[action.kind]}`}>
                                                {KIND_LABEL[action.kind]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-900">{action.client}</td>
                                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-900">{formatRub(action.amount)}</td>
                                        <td className="px-3 py-2 font-semibold text-gray-900">{action.action}</td>
                                        <td className="px-3 py-2 text-gray-600">
                                            {action.done && action.doneBy
                                                ? <span className="text-green-700">сделано сегодня: {action.doneBy}</span>
                                                : action.reason}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <Link
                                                href={`/orders?order=${action.orderId}&from=my-day`}
                                                className="text-xs font-bold text-blue-700 hover:underline"
                                            >
                                                №{action.orderNumber}
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        );
                    })}
                </table>
            )}
        </section>
    );
}

function PlanCard({ plan }: { plan: MyDay['plan'] }) {
    const monthName = new Date().toLocaleDateString('ru-RU', { month: 'long' });

    if (!plan.target) {
        return (
            <section className="border border-gray-200 bg-white p-3">
                <h3 className="text-sm font-bold text-gray-900">Мой план на {monthName}</h3>
                <p className="mt-1 text-xs text-gray-600">
                    План на этот месяц не заведён — его ставят в «Настройках мотивации».
                </p>
            </section>
        );
    }

    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Мой план на {monthName}</h3>

            <div className="grid grid-cols-3 gap-2">
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
                До конца месяца: <b className="text-gray-900">{plan.workdaysLeft}</b> рабочих дн. · нужно в день{' '}
                <b className="text-gray-900">{formatRub(plan.perDay)}</b>
            </p>

            {/* Факт — снимок ведомости зарплаты, а не живой пересчёт: человек
                должен видеть, на какой момент цифра и из скольких заказов. */}
            <p className="mt-1 text-[11px] text-gray-500">
                {plan.computedAt
                    ? `Факт из ведомости зарплаты: ${plan.soldOrders} заказ(ов), данные на ${new Date(plan.computedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                    : 'Зарплата за этот месяц ещё не считалась — факт появится после ближайшего расчёта'}
            </p>
        </section>
    );
}

function FunnelCard({ funnel }: { funnel: MyDay['funnel'] }) {
    if (funnel.length === 0) return null;

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

function MetricsCard({
    metrics,
    plan,
    counts,
}: {
    metrics: MyDay['metrics'];
    plan: MyDay['plan'];
    counts: MyDay['counts'];
}) {
    const talkShare = metrics.callsToday > 0 ? Math.round((metrics.talksToday / metrics.callsToday) * 100) : 0;
    const doneShare = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Мои показатели</h3>
            <div className="grid grid-cols-2 gap-2">
                <Metric label="Звонки сегодня" value={String(metrics.callsToday)} note={`разговоров ${metrics.talksToday}`} pct={talkShare} />
                <Metric label="Заявки за месяц" value={String(metrics.ordersMonth)} note="новых в работе" pct={null} />
                <Metric label="Отработано задач" value={`${counts.done} из ${counts.total}`} note="за сегодня" pct={doneShare} />
                <Metric label="Выручка за месяц" value={formatRub(metrics.revenueMonth)} note={`план ${plan.factPct}%`} pct={plan.factPct} />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-gray-500">
                Разговором считается состоявшийся звонок дольше 20 секунд: гудки и автоответчик работой не считаются.
            </p>
        </section>
    );
}

function Metric({ label, value, note, pct }: { label: string; value: string; note: string; pct: number | null }) {
    return (
        <div className="border border-gray-100 bg-gray-50 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
            <p className="text-lg font-bold tabular-nums text-gray-900">{value}</p>
            <p className="text-[10px] text-gray-500">{note}</p>
            {pct !== null && (
                <div className="mt-1 h-1 w-full bg-gray-200">
                    <div
                        className={`h-1 ${pct >= 80 ? 'bg-green-600' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                    />
                </div>
            )}
        </div>
    );
}

/** Что ещё ждёт сегодня: следующие по приоритету, которых нет в «Далее». */
function UpcomingCard({ actions }: { actions: Action[] }) {
    const rest = actions.filter((a) => !a.done).slice(5, 9);
    if (rest.length === 0) return null;

    return (
        <section className="border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Дальше по очереди</h3>
            <ul className="space-y-2">
                {rest.map((action) => (
                    <li key={action.orderNumber} className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0">
                            <Link
                                href={`/orders?order=${action.orderId}&from=my-day`}
                                className="block truncate text-xs font-semibold text-gray-900 hover:text-blue-700"
                            >
                                {action.client}
                            </Link>
                            <p className="truncate text-[11px] text-gray-500">{action.action} · {action.reason}</p>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-600">{formatRub(action.amount)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Подсказка дня: считается по той же очереди, ничего не выдумываем. */
function AssistantCard({ day }: { day: MyDay }) {
    const open = day.all.filter((a) => !a.done);
    if (open.length === 0) return null;

    const topThree = open.slice(0, 3);
    const topSum = topThree.reduce((sum, a) => sum + a.amount, 0);
    const openSum = open.reduce((sum, a) => sum + a.amount, 0);

    return (
        <section className="border border-blue-200 bg-blue-50 p-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-blue-900">
                <Lightbulb size={14} /> Подсказка дня
            </h3>
            <p className="text-xs leading-snug text-blue-900">
                В очереди {open.length} действий на {formatRub(openSum)}. Первые три дают {formatRub(topSum)} —
                это {openSum > 0 ? Math.round((topSum / openSum) * 100) : 0}% суммы дня, с них и начните.
            </p>
            {day.plan.target > 0 && day.plan.perDay > 0 && (
                <p className="mt-1 text-xs text-blue-900">
                    Чтобы выйти на план, сегодня нужно закрыть {formatRub(day.plan.perDay)}.
                </p>
            )}
        </section>
    );
}
