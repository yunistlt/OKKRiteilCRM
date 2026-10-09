'use client';

/**
 * Всплывающее оповещение по заказу: письмо, задача или входящий звонок.
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
import CallOrderPicker from '@/components/orders/CallOrderPicker';

type Alert = {
    id: string;
    /** Письмо, задача или звонок: заголовок и содержимое у них разные. */
    kind: 'mail' | 'task' | 'call';
    /** Идентификатор звонка — по нему менеджер указывает заказ. */
    callId?: string | null;
    /** Номер знаком: карточка клиента нашлась, даже если заказа у звонка нет. */
    knownClient?: boolean;
    orderNumber: string;
    /** Тема письма или текст задачи — то, ради чего человек это читает. */
    text: string;
    /** От кого письмо или кто поставил задачу и на когда. */
    note: string;
    /** Клиент заказа: имя и карточка. Имя кликабельно — просьба владельца 08.10.2026. */
    clientName?: string | null;
    clientId?: number | null;
};

/** Как часто спрашиваем о новых письмах. Почта приезжает кроном раз в 5 минут. */
const POLL_MS = 60_000;
/** Сколько висит оповещение, если его не трогать. */
const HIDE_MS = 60_000;

/**
 * Что уже показывали — переживает перерисовку.
 *
 * Отметки жили в памяти компонента, и любое его перемонтирование (оно
 * случается при сохранении заказа и при переходах) обнуляло их: оповещения
 * выскакивали заново по письмам, которые человек уже прочитал, и по звонкам,
 * которые давно кончились. Ирина и Елена 09.10.2026: «при каждом сохранении в
 * заказе выскакивают слева и справа оповещения… ужасно мешает работать».
 *
 * Поэтому храним в браузере: ключ оповещения → когда показали. Старше суток
 * вычищаем, чтобы список не рос бесконечно.
 */
const SEEN_KEY = 'okk.alerts.seen';
const SINCE_KEY = 'okk.alerts.since';
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

function loadSeen(): Map<string, number> {
    try {
        const raw = window.localStorage.getItem(SEEN_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const now = Date.now();
        const map = new Map<string, number>();
        for (const [id, at] of Object.entries(parsed as Record<string, number>)) {
            if (now - Number(at) < SEEN_TTL_MS) map.set(id, Number(at));
        }
        return map;
    } catch {
        // Приватный режим или запрет на хранилище: работаем без памяти.
        return new Map();
    }
}

function saveSeen(map: Map<string, number>) {
    try {
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(map)));
    } catch {
        // Не записалось — хуже будет только повтор оповещения.
    }
}

export default function IncomingMailAlerts() {
    const pathname = usePathname();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const since = useRef<string | null>(null);
    const seen = useRef<Map<string, number>>(new Map());
    const restored = useRef(false);

    // Поднимаем память о показанном один раз при появлении компонента.
    if (typeof window !== 'undefined' && !restored.current) {
        restored.current = true;
        seen.current = loadSeen();
        try {
            since.current = window.localStorage.getItem(SINCE_KEY);
        } catch {
            since.current = null;
        }
    }

    const check = useCallback(async () => {
        const query = since.current ? `?since=${encodeURIComponent(since.current)}` : '';

        try {
            const [mailRes, taskRes, callRes] = await Promise.all([
                fetch(`/api/emails/incoming-alerts${query}`),
                fetch(`/api/orders/task-alerts${query}`),
                fetch(`/api/calls/alerts${query}`),
            ]);

            const fresh: Alert[] = [];

            if (mailRes.ok) {
                const payload = await mailRes.json();
                since.current = payload.checkedAt || since.current;
                try {
                    if (since.current) window.localStorage.setItem(SINCE_KEY, since.current);
                } catch { /* хранилище недоступно — переживём */ }
                for (const letter of (payload.letters || [])) {
                    fresh.push({
                        id: letter.id,
                        kind: 'mail',
                        orderNumber: letter.orderNumber,
                        text: letter.subject,
                        note: letter.from,
                        clientName: letter.clientName ?? null,
                        clientId: letter.clientId ?? null,
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
                        clientName: task.clientName ?? null,
                        clientId: task.clientId ?? null,
                    });
                }
            }

            if (callRes.ok) {
                const payload = await callRes.json();
                for (const call of (payload.calls || [])) {
                    fresh.push({
                        id: call.id,
                        kind: 'call',
                        callId: call.callId || null,
                        knownClient: Boolean(call.knownClient),
                        orderNumber: call.orderNumber || '',
                        // Кто звонит — главное в этом оповещении: номер сам по
                        // себе ничего не говорит (Женя 05.10.2026).
                        text: call.clientName || call.phone || 'Неизвестный номер',
                        note: [call.phone, call.managerName ? `менеджер ${call.managerName}` : null]
                            .filter(Boolean).join(' · '),
                        // У звонка имя клиента — это сам заголовок оповещения,
                        // поэтому отдельной строкой его не повторяем: нужен
                        // только номер карточки, чтобы заголовок вёл в неё.
                        clientName: call.orderNumber ? (call.clientName ?? null) : null,
                        clientId: call.clientId ?? null,
                    });
                }
            }

            const unseen = fresh.filter((item) => !seen.current.has(item.id));
            if (unseen.length) {
                const now = Date.now();
                for (const item of unseen) seen.current.set(item.id, now);
                saveSeen(seen.current);
            }
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
                <div key={alert.id} className={`border bg-white shadow-lg ${alert.kind === 'task' ? 'border-amber-200' : alert.kind === 'call' ? 'border-green-200' : 'border-blue-200'}`}>
                    <div className={`flex items-center justify-between px-3 py-1.5 ${alert.kind === 'task' ? 'bg-amber-600' : alert.kind === 'call' ? 'bg-green-700' : 'bg-blue-600'}`}>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">
                            {alert.kind === 'task' ? 'Задача по заказу' : alert.kind === 'call' ? 'Входящий звонок' : 'Письмо по заказу'}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                // Закрыл — значит прочитал: второй раз не показываем.
                                seen.current.set(alert.id, Date.now());
                                saveSeen(seen.current);
                                setAlerts((current) => current.filter((item) => item.id !== alert.id));
                            }}
                            className="px-1 text-sm leading-none text-white/80 hover:text-white"
                            title="Закрыть"
                        >
                            ×
                        </button>
                    </div>
                    <div className="px-3 py-2">
                        {alert.orderNumber ? (
                            <div className="text-sm font-semibold text-gray-900">
                                Заказ <OrderNumberLink number={alert.orderNumber} />
                            </div>
                        ) : (
                            // Звонок с незнакомого номера — заказа у него нет, и
                            // врать про заказ нельзя. Менеджер называет заказ сам:
                            // угадывать по телефону мы перестали (решение
                            // владельца 05.10.2026).
                            <div>
                                {/* Номер знаком — говорим, кто звонит, и честно
                                    пишем, что заказа у звонка нет. Незнакомый
                                    номер так и называем (решение владельца
                                    05.10.2026). */}
                                <div className="text-sm font-semibold text-gray-900">
                                    {alert.kind === 'call'
                                        ? (alert.knownClient ? 'Заказов не найдено' : 'Номер неизвестен, заказа нет')
                                        : 'Заказ не найден'}
                                </div>
                                {alert.kind === 'call' && alert.callId && (
                                    <CallOrderPicker
                                        callId={alert.callId}
                                        onBound={(orderNumber) => setAlerts((current) =>
                                            current.map((item) => (item.id === alert.id ? { ...item, orderNumber } : item)))}
                                    />
                                )}
                            </div>
                        )}
                        {/* Клиент заказа — ссылка на карточку: из оповещения
                            сразу видно, кто это, и можно открыть его целиком
                            (просьба владельца 08.10.2026). У звонка клиент сам
                            является заголовком, и ссылкой становится он. */}
                        {alert.kind === 'call' ? (
                            <div className="mt-1 text-sm text-gray-800" title={alert.text}>
                                {alert.clientId ? (
                                    <a href={`/clients/${alert.clientId}`} className="font-semibold text-blue-700 hover:underline">
                                        {alert.text}
                                    </a>
                                ) : alert.text}
                            </div>
                        ) : (
                            <>
                                {alert.clientName && (
                                    <div className="mt-0.5 truncate text-xs" title={alert.clientName}>
                                        {alert.clientId ? (
                                            <a href={`/clients/${alert.clientId}`} className="font-semibold text-blue-700 hover:underline">
                                                {alert.clientName}
                                            </a>
                                        ) : (
                                            <span className="text-gray-500">{alert.clientName}</span>
                                        )}
                                    </div>
                                )}
                                <div className="mt-1 text-sm text-gray-800" title={alert.text}>{alert.text}</div>
                            </>
                        )}
                        <div className="mt-0.5 truncate text-xs text-gray-500">{alert.note}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
