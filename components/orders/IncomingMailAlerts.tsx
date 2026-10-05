'use client';

/**
 * Всплывающее оповещение по заказу: пришло письмо или поставили задачу.
 *
 * Лена Парфёнова 05.10.2026: «можно настроить оповещения по входящим письмам в
 * конкретный заказ? Всплывающее окно было в RetailCRM». Письмо по заказу — повод
 * ответить сегодня, а раньше его замечали, только зайдя в карточку.
 *
 * Ирина Гордеева 05.10.2026: «задача поставленная выскакивает как письмо.
 * Можно, чтобы была указана сама задача?» — у задачи свой заголовок, свой цвет
 * и её текст целиком.
 *
 * Показываем правым нижним углом, не перекрывая панель телефона (она занимает
 * верх справа) и не мешая работе: оповещение не модальное, закрывается крестиком
 * и само исчезает через минуту.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import OrderNumberLink from '@/components/ui/OrderNumberLink';

type Alert = {
    id: string;
    /** Письмо или задача: заголовок и содержимое у них разные. */
    kind: 'mail' | 'task';
    orderNumber: string;
    /** Тема письма или текст задачи — то, ради чего человек это читает. */
    text: string;
    /** От кого письмо или кто поставил задачу и на когда. */
    note: string;
};

/** Как часто спрашиваем о новых письмах. Почта приезжает кроном раз в 5 минут. */
const POLL_MS = 60_000;
/** Сколько висит оповещение, если его не трогать. */
const HIDE_MS = 60_000;

export default function IncomingMailAlerts() {
    const pathname = usePathname();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const since = useRef<string | null>(null);
    const seen = useRef<Set<string>>(new Set());

    const check = useCallback(async () => {
        const query = since.current ? `?since=${encodeURIComponent(since.current)}` : '';

        try {
            const [mailRes, taskRes] = await Promise.all([
                fetch(`/api/emails/incoming-alerts${query}`),
                fetch(`/api/orders/task-alerts${query}`),
            ]);

            const fresh: Alert[] = [];

            if (mailRes.ok) {
                const payload = await mailRes.json();
                since.current = payload.checkedAt || since.current;
                for (const letter of (payload.letters || [])) {
                    fresh.push({
                        id: letter.id,
                        kind: 'mail',
                        orderNumber: letter.orderNumber,
                        text: letter.subject,
                        note: letter.from,
                    });
                }
            }

            if (taskRes.ok) {
                const payload = await taskRes.json();
                for (const task of (payload.tasks || [])) {
                    fresh.push({
                        id: task.id,
                        kind: 'task',
                        orderNumber: task.orderNumber,
                        // Текст задачи — то, о чём просила Ирина: иначе
                        // оповещение ничего не говорит.
                        text: task.title,
                        note: [task.due ? `срок ${task.due}` : null, task.author ? `поставил ${task.author}` : null]
                            .filter(Boolean).join(' · '),
                    });
                }
            }

            const unseen = fresh.filter((item) => !seen.current.has(item.id));
            for (const item of unseen) seen.current.add(item.id);
            if (unseen.length) setAlerts((current) => [...unseen, ...current].slice(0, 4));
        } catch {
            // Молча: оповещение — не та вещь, ради которой стоит пугать человека ошибкой.
        }
    }, []);

    useEffect(() => {
        void check();
        const timer = setInterval(() => void check(), POLL_MS);
        return () => clearInterval(timer);
    }, [check]);

    // Само исчезает, чтобы не копиться в углу.
    useEffect(() => {
        if (!alerts.length) return;
        const timer = setTimeout(() => setAlerts((current) => current.slice(0, -1)), HIDE_MS);
        return () => clearTimeout(timer);
    }, [alerts]);

    // На странице входа и в мессенджере не мешаем.
    if (!alerts.length || pathname === '/login' || pathname.startsWith('/messenger')) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[200] flex w-80 flex-col gap-2">
            {alerts.map((alert) => (
                <div key={alert.id} className={`border bg-white shadow-lg ${alert.kind === 'task' ? 'border-amber-200' : 'border-blue-200'}`}>
                    <div className={`flex items-center justify-between px-3 py-1.5 ${alert.kind === 'task' ? 'bg-amber-600' : 'bg-blue-600'}`}>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">
                            {alert.kind === 'task' ? 'Задача по заказу' : 'Письмо по заказу'}
                        </span>
                        <button
                            type="button"
                            onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
                            className="px-1 text-sm leading-none text-white/80 hover:text-white"
                            title="Закрыть"
                        >
                            ×
                        </button>
                    </div>
                    <div className="px-3 py-2">
                        <div className="text-sm font-semibold text-gray-900">
                            Заказ <OrderNumberLink number={alert.orderNumber} />
                        </div>
                        <div className="mt-1 text-sm text-gray-800" title={alert.text}>{alert.text}</div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">{alert.note}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
