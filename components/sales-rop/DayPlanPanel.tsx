'use client';

/**
 * План дня в интерфейсе.
 *
 * Утром бот-РОП присылает план в Telegram, и дальше менеджер держит его в
 * другом окне. Теперь тот же план открывается прямо в CRM при первом входе за
 * день: заказы, по которым сегодня нужно поработать, причина и отметка
 * «отработано» (требование владельца 01.10.2026).
 *
 * Состав плана берём из того же `sales_rop_task`, что и письмо бота: два
 * источника правды разошлись бы в первый же день.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatRub } from '@/lib/format';

export type PlanTask = {
    orderId: number;
    orderNumber: string;
    client: string;
    amount: number;
    reason: string;
    statusName: string;
    done: boolean;
    doneBy: string | null;
    /** Чей заказ — показываем только в плане отдела. */
    managerName?: string;
};

type Plan = {
    scope: 'own' | 'department';
    date: string;
    tasks?: PlanTask[];
    managers?: Array<{ managerId: number; name: string; tasks: PlanTask[]; total: number; done: number }>;
    total: number;
    done: number;
    rule: string;
    note?: string;
};

export default function DayPlanPanel({ onClose }: { onClose?: () => void }) {
    const [plan, setPlan] = useState<Plan | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/sales-rop/my-plan');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'План не загрузился');
            setPlan(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'План не загрузился');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const left = plan ? plan.total - plan.done : 0;

    // План отдела показываем тем же списком, что и свой, — добавляется только
    // подпись, чей это заказ (решение владельца 01.10.2026).
    const tasks: PlanTask[] = plan?.scope === 'department'
        ? (plan.managers ?? []).flatMap((m) => m.tasks.map((t) => ({ ...t, managerName: m.name })))
        : (plan?.tasks ?? []);

    return (
        <section
            data-ui-audit-zone="day-plan"
            className="flex min-h-0 flex-[2] flex-col border-b border-slate-700 bg-white"
        >
            <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-900 px-3 py-2">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        {plan?.scope === 'department' ? 'План отдела на день' : 'План на день'}
                    </p>
                    <p className="truncate text-sm font-bold text-white">
                        {plan ? new Date(plan.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '—'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {plan && tasks.length > 0 && (
                        <span className="text-xs text-gray-300">
                            Осталось <b className="text-white">{left}</b> из {plan.total}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={load}
                        title="Обновить план"
                        className="text-xs font-bold text-gray-300 hover:text-white"
                    >
                        ↻
                    </button>
                    {/* Закрывать план нельзя: он должен быть перед глазами весь день
                        (требование владельца 01.10.2026). Кнопка есть только на
                        телефоне, где панель открывается поверх экрана. */}
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-xs font-bold text-gray-300 hover:text-white md:hidden"
                        >
                            Закрыть
                        </button>
                    )}
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                    <p className="px-3 py-4 text-sm text-gray-500">Поднимаем план…</p>
                ) : error ? (
                    <p className="px-3 py-4 text-sm text-amber-800">{error}</p>
                ) : !plan || tasks.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-gray-600">
                        {plan?.note || 'На сегодня задач в плане нет.'}
                    </p>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {tasks.map((task) => (
                            <li
                                key={`${task.managerName ?? ''}-${task.orderNumber}`}
                                className={`px-3 py-2 ${task.done ? 'bg-green-50/60' : ''}`}
                            >
                                <div className="flex items-baseline justify-between gap-2">
                                    {/* Один клик — и открыта карточка заказа, а не список. */}
                                    <a
                                        href={`/orders?order=${task.orderId}`}
                                        className={`text-sm font-bold ${task.done ? 'text-gray-400 line-through' : 'text-blue-700 hover:underline'}`}
                                    >
                                        №{task.orderNumber}
                                    </a>
                                    <span className="shrink-0 text-xs tabular-nums text-gray-600">{formatRub(task.amount)}</span>
                                </div>
                                <p className={`truncate text-xs ${task.done ? 'text-gray-400' : 'text-gray-800'}`} title={task.client}>
                                    {task.client}
                                </p>
                                {task.managerName && (
                                    <p className="text-[11px] font-semibold text-gray-500">{task.managerName}</p>
                                )}
                                {task.reason && (
                                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{task.reason}</p>
                                )}
                                {task.done && (
                                    /* Перенос даты без объяснения — не работа, а нарушение:
                                       им можно бесконечно отодвигать клиента (закон владельца
                                       05.10.2026). Красим иначе и называем честно. */
                                    task.doneBy === 'перенос даты без причины' ? (
                                        <p className="mt-0.5 text-[11px] font-semibold text-red-700">
                                            Нарушение: дату перенесли без причины
                                        </p>
                                    ) : (
                                        <p className="mt-0.5 text-[11px] font-semibold text-green-700">
                                            Отработан{task.doneBy ? `: ${task.doneBy}` : ''}
                                        </p>
                                    )
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {plan && tasks.length > 0 && (
                <p className="shrink-0 border-t border-gray-200 px-3 py-1.5 text-[11px] leading-snug text-gray-500">
                    {plan.rule}
                </p>
            )}
        </section>
    );
}
