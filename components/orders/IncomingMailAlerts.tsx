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
/**
 * Сколько висит оповещение, если его не трогать.
 *
 * Письма и задачи сюда не попадают: они висят, пока человек не закроет
 * крестиком. Письмо — решение владельца 15.10.2026, задача — его же решение
 * 20.10.2026 по жалобе Ирины Гордеевой: «нет оповещения на экране, если
 * ставишь задачу на определённое время, окошко не выскакивает». Окно
 * выскакивало минута в минуту, но гасло через минуту: отошла от стола — и
 * напоминания нет. Задача, как и письмо, — работа, которую надо сделать.
 *
 * Гаснут сами только звонки: разговор либо состоялся, либо нет, напоминать о
 * нём потом незачем.
 */
const HIDE_MS = 60_000;

export default function IncomingMailAlerts() {
    const pathname = usePathname();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    /**
     * Что человеку уже показывали, помнит СИСТЕМА: сервер отдаёт только новое
     * и сразу это запоминает (`alert_seen`). Браузер ничего не хранит — у
     * менеджера бывает два рабочих места, и память одного окна другому не
     * помогает (решение владельца 09.10.2026).
     */

    const check = useCallback(async () => {
        try {
            const [mailRes, taskRes, callRes] = await Promise.all([
                fetch('/api/emails/incoming-alerts'),
                fetch('/api/orders/task-alerts'),
                fetch('/api/calls/alerts'),
            ]);

            const fresh: Alert[] = [];

            if (mailRes.ok) {
                const payload = await mailRes.json();
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

            /**
             * Сервер уже отдал только новое: повторов тут быть не может.
             *
             * В углу держим не больше четырёх окошек, и уступают место задачи
             * и звонки: они и так гаснут сами. Письма не вытесняются НИКОГДА —
             * сколько пришло, столько и висит, пока человек не закроет каждое
             * крестиком (Евгения Матвеева 15.10.2026: «чтобы не пропадали,
             * когда пришло письмо, мы сами закроем оповещение»). Если писем
             * больше четырёх, столбик прокручивается.
             */
            if (fresh.length) setAlerts((current) => {
                const all = [...fresh, ...current];
                if (all.length <= 4) return all;
                // Из угла вытесняются только звонки: письмо и задачу снимает
                // человек крестиком, иначе они пропадут незамеченными.
                const kept = all.filter((item) => item.kind !== 'call');
                const calls = all.filter((item) => item.kind === 'call');
                return [...kept, ...calls].slice(0, Math.max(4, kept.length));
            });
        } catch {
            // Молча: оповещение — не та вещь, ради которой стоит пугать человека ошибкой.
        }
    }, []);

    useEffect(() => {
        void check();
        const timer = setInterval(() => void check(), POLL_MS);
        return () => clearInterval(timer);
    }, [check]);

    /**
     * Само исчезает только оповещение о звонке. Письмо и задачу снимает
     * человек крестиком (решения владельца 15.10.2026 и 20.10.2026).
     */
    useEffect(() => {
        if (!alerts.some((item) => item.kind === 'call')) return;
        const timer = setTimeout(() => setAlerts((current) => {
            // Гасим самое старое из гаснущих, письма и задачи не трогаем.
            for (let index = current.length - 1; index >= 0; index -= 1) {
                if (current[index].kind === 'call') {
                    return current.filter((_, position) => position !== index);
                }
            }
            return current;
        }), HIDE_MS);
        return () => clearTimeout(timer);
    }, [alerts]);

    // На странице входа и в мессенджере не мешаем.
    if (!alerts.length || pathname === '/login' || pathname.startsWith('/messenger')) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[200] flex max-h-[calc(100vh-2rem)] w-80 flex-col gap-2 overflow-y-auto">
            {alerts.map((alert) => (
                <div key={alert.id} className={`border bg-white shadow-lg ${alert.kind === 'task' ? 'border-amber-200' : alert.kind === 'call' ? 'border-green-200' : 'border-blue-200'}`}>
                    <div className={`flex items-center justify-between px-3 py-1.5 ${alert.kind === 'task' ? 'bg-amber-600' : alert.kind === 'call' ? 'bg-green-700' : 'bg-blue-600'}`}>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">
                            {alert.kind === 'task' ? 'Задача по заказу' : alert.kind === 'call' ? 'Входящий звонок' : 'Письмо по заказу'}
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
