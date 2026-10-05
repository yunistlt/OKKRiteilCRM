'use client';

/**
 * Всплывающее оповещение о письме по заказу.
 *
 * Лена Парфёнова 05.10.2026: «можно настроить оповещения по входящим письмам в
 * конкретный заказ? Всплывающее окно было в RetailCRM». Письмо по заказу — повод
 * ответить сегодня, а раньше его замечали, только зайдя в карточку.
 *
 * Показываем правым нижним углом, не перекрывая панель телефона (она занимает
 * верх справа) и не мешая работе: оповещение не модальное, закрывается крестиком
 * и само исчезает через минуту.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import OrderNumberLink from '@/components/ui/OrderNumberLink';

type MailAlert = {
    id: string;
    orderNumber: string;
    subject: string;
    from: string;
    receivedAt: string;
};

/** Как часто спрашиваем о новых письмах. Почта приезжает кроном раз в 5 минут. */
const POLL_MS = 60_000;
/** Сколько висит оповещение, если его не трогать. */
const HIDE_MS = 60_000;

export default function IncomingMailAlerts() {
    const pathname = usePathname();
    const [alerts, setAlerts] = useState<MailAlert[]>([]);
    const since = useRef<string | null>(null);
    const seen = useRef<Set<string>>(new Set());

    const check = useCallback(async () => {
        try {
            const url = since.current
                ? `/api/emails/incoming-alerts?since=${encodeURIComponent(since.current)}`
                : '/api/emails/incoming-alerts';
            const res = await fetch(url);
            if (!res.ok) return;
            const payload = await res.json();
            since.current = payload.checkedAt || since.current;

            const fresh = (payload.letters || []).filter((letter: MailAlert) => !seen.current.has(letter.id));
            for (const letter of fresh) seen.current.add(letter.id);
            if (fresh.length) setAlerts((current) => [...fresh, ...current].slice(0, 4));
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
                <div key={alert.id} className="border border-blue-200 bg-white shadow-lg">
                    <div className="flex items-center justify-between bg-blue-600 px-3 py-1.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Письмо по заказу</span>
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
                        <div className="mt-1 truncate text-sm text-gray-800" title={alert.subject}>{alert.subject}</div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">{alert.from}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
