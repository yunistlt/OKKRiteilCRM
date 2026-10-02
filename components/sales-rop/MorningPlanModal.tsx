'use client';

/**
 * Утреннее окно с планом дня.
 *
 * При первом входе за день план открывается поверх всего: человек должен его
 * прочитать, а не отмахнуться. Закрыть можно через 15 секунд — столько уходит
 * на чтение, и без этой паузы окно закрывают раньше, чем успевают увидеть
 * первую строку (требование владельца 01.10.2026).
 *
 * Текст — тот же, что бот прислал в Telegram, с причинами и советами. После
 * закрытия план остаётся на своём месте, в правой колонке, и там висит весь
 * день.
 */
import { useEffect, useState } from 'react';
import { formatRub } from '@/lib/format';
import { renderLetter } from '@/lib/sales-rop/letter-render';

/** Сколько секунд окно держится: столько нужно, чтобы прочитать план. */
const READING_SECONDS = 15;

type MorningTask = { orderId: number; orderNumber: string; client: string; amount: number; reason: string; done: boolean };

export type MorningPlan = {
    scope: 'own' | 'department';
    date: string;
    total: number;
    done: number;
    letter: string | null;
    tasks?: MorningTask[];
    managers?: Array<{ name: string; tasks: MorningTask[] }>;
};

export default function MorningPlanModal({ plan, onClose }: { plan: MorningPlan; onClose: () => void }) {
    const [left, setLeft] = useState(READING_SECONDS);

    useEffect(() => {
        const timer = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
        return () => clearInterval(timer);
    }, []);

    const canClose = left === 0;

    // Запасной вид, если текст письма не сохранился: список задач тем же составом.
    const fallbackTasks = plan.scope === 'department'
        ? (plan.managers ?? []).flatMap((m) => m.tasks.map((t) => ({ ...t, who: m.name })))
        : (plan.tasks ?? []).map((t) => ({ ...t, who: '' }));

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4">
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col border border-gray-300 bg-white shadow-2xl">
                <header className="flex shrink-0 items-start justify-between gap-4 bg-gray-900 px-5 py-3">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            {plan.scope === 'department' ? 'План отдела на день' : 'План на день'}
                        </p>
                        <h2 className="text-lg font-bold text-white">
                            {new Date(plan.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}
                        </h2>
                        <p className="mt-0.5 text-xs text-gray-300">
                            Задач на сегодня: <b className="text-white">{plan.total}</b>
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={canClose ? onClose : undefined}
                        disabled={!canClose}
                        title={canClose ? 'Закрыть — план останется справа' : 'Прочитайте план'}
                        className={`shrink-0 border px-3 py-1.5 text-sm font-bold ${
                            canClose
                                ? 'border-white text-white hover:bg-white hover:text-gray-900'
                                : 'border-gray-600 text-gray-500'
                        }`}
                    >
                        {canClose ? '✕ Закрыть' : `✕ через ${left} с`}
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {plan.letter ? (
                        // Тот же текст, что в Telegram, но разметка бота разобрана:
                        // номера заказов — ссылками на нашу карточку, а не строкой
                        // «<a href=…>» и не в RetailCRM (поймано 02.10.2026).
                        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
                            {renderLetter(plan.letter).map((segments, lineIndex) => (
                                <p key={lineIndex} className="min-h-[2px]">
                                    {segments.map((segment, index) =>
                                        segment.kind === 'order' ? (
                                            <a
                                                key={index}
                                                href={`/orders?order=${segment.order}`}
                                                className="font-bold text-blue-700 hover:underline"
                                            >
                                                {segment.label}
                                            </a>
                                        ) : (
                                            <span key={index}>{segment.text}</span>
                                        ),
                                    )}
                                </p>
                            ))}
                        </div>
                    ) : fallbackTasks.length > 0 ? (
                        <ul className="space-y-3">
                            {fallbackTasks.map((task, index) => (
                                <li key={`${task.orderNumber}-${index}`} className="border-b border-gray-100 pb-2">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <a href={`/orders?order=${task.orderId}`} className="text-sm font-bold text-blue-700 hover:underline">
                                            №{task.orderNumber}
                                        </a>
                                        <span className="text-sm tabular-nums text-gray-700">{formatRub(task.amount)}</span>
                                    </div>
                                    <p className="text-sm text-gray-900">{task.client}</p>
                                    {task.who && <p className="text-xs font-semibold text-gray-500">{task.who}</p>}
                                    {task.reason && <p className="mt-0.5 text-xs text-gray-600">{task.reason}</p>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-600">На сегодня задач в плане нет.</p>
                    )}
                </div>

                <footer className="shrink-0 border-t border-gray-200 bg-gray-50 px-5 py-2 text-xs text-gray-600">
                    После закрытия план останется справа — он виден весь день.
                </footer>
            </div>
        </div>
    );
}
