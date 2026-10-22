'use client';

import { useCallback, useEffect, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import CallOrderPicker from '@/components/orders/CallOrderPicker';
import CallSummary from '@/components/calls/CallSummary';

/**
 * Телефон звонит ПРЯМО СЕЙЧАС.
 *
 * Разделение владельца 05.10.2026: звонок — событие, происходящее сейчас;
 * запись звонка — результат уже произошедшего. Это окно показывает первое: оно
 * появляется, пока идёт гудок, и гаснет, когда трубку подняли или звонок
 * сорвался.
 *
 * Событие приходит из `active_calls` через Realtime — его туда кладёт вебхук
 * Телфина. Опрос раз в минуту для такого не годится: разговор начнётся раньше,
 * чем мы спросим.
 */
type Ringing = {
    telphin_call_id: string;
    direction: string | null;
    from_number: string | null;
    client_name: string | null;
    order_number: string | null;
    status: string | null;
    started_at: string | null;
    /** Добавочный, на который идёт звонок: по нему окно адресуется хозяину телефона. */
    extension_number: string | null;
    /** Все добавочные звонка: кому звонили и на кого перевели — окно видят все они. */
    extensions: string[] | null;
    /** Звонок на очередь — телефон звонит у нескольких, окно видят все. */
    is_queue: boolean | null;
    /** Заказы этого клиента, когда звонок ни к одному не привязан. */
    client_orders?: Array<{ orderId: number; number: string }>;
    /**
     * Кому звонит телефон: добавочный и менеджер за ним. При переводе здесь
     * оба — кому звонили сначала и на кого перевели (просьба Ирины Гордеевой
     * 20.10.2026: в оповещении не видно, кому звонят).
     */
    ringing_at?: Array<{ extension: string; name: string | null }>;
};

/** Как часто спрашиваем о звонках. Звонок звонит 20–30 секунд. */
const POLL_MS = 4_000;
/**
 * В скрытой вкладке окна звонка всё равно не видно, поэтому там опрашиваем
 * редко. У менеджера CRM открыта в нескольких вкладках сразу, и опрос каждые
 * две секунды из каждой давал 2 900 запросов в минуту на отдел — на этом
 * 22.10.2026 лёг прокси.
 */
const HIDDEN_POLL_MS = 30_000;

export default function RingingCallAlert() {
    const [calls, setCalls] = useState<Ringing[]>([]);
    /**
     * Звонки, которые человек закрыл крестиком. Иначе следующий заход показал
     * бы окно снова: звонок-то ещё идёт.
     */
    const [hidden, setHidden] = useState<string[]>([]);

    const drop = useCallback((callId: string) => {
        setHidden((current) => (current.includes(callId) ? current : [...current, callId]));
        setCalls((current) => current.filter((row) => row.telphin_call_id !== callId));
    }, []);
    /**
     * Чей это телефон. Окно всплывает у хозяина добавочного; руководитель и ОКК
     * видят все звонки, звонок на очередь — тоже все (решение владельца
     * 05.10.2026).
     */
    /**
     * Звонки спрашиваем у своего маршрута каждые две секунды.
     *
     * Раньше окно слушало изменения таблицы напрямую из браузера. Но браузер
     * подключается к базе АНОНИМНО — вход в ОКК свой, в Supabase Auth мы не
     * логинимся, — а читать таблицу звонков разрешено только авторизованным.
     * Поэтому до экрана не доходило НИ ОДНО событие, и работал только опрос
     * раз в минуту по уже завершённым звонкам: оповещение приходило после
     * разговора (жалоба Евгении Матвеевой 07.10.2026).
     *
     * Две секунды — звонок звонит 20–30 секунд, окно успевает появиться почти
     * сразу. Кому показывать звонок, решает сервер: там наша сессия.
     */
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const check = async () => {
            try {
                const res = await fetch('/api/calls/active');
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled) {
                        // Завершённые звонки сервер уже не отдаёт — окно гаснет само.
                        setCalls((data.calls ?? [])
                            .filter((c: Ringing) => c.status !== 'ended' && !hidden.includes(c.telphin_call_id))
                            .slice(0, 3));
                    }
                }
            } catch {
                // Связь моргнула — попробуем на следующем заходе.
            }
            if (!cancelled) timer = setTimeout(() => void check(), document.hidden ? HIDDEN_POLL_MS : POLL_MS);
        };

        void check();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [hidden]);

    if (!calls.length) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[300] flex w-96 flex-col gap-2">
            {calls.map((call) => (
                <div key={call.telphin_call_id} className="border-2 border-green-600 bg-white shadow-xl">
                    <div className="flex items-center justify-between bg-green-700 px-3 py-2">
                        <span className="text-xs font-black uppercase tracking-widest text-white">
                            {call.status === 'answered'
                                ? 'Разговор идёт'
                                : call.direction === 'outgoing' ? 'Идёт звонок' : 'Звонят вам'}
                        </span>
                        <button
                            type="button"
                            onClick={() => drop(call.telphin_call_id)}
                            className="px-1 text-base leading-none text-white/80 hover:text-white"
                            title="Скрыть"
                        >
                            ×
                        </button>
                    </div>

                    <div className="px-3 py-2">
                        <div className="text-lg font-bold text-gray-900">{call.from_number || 'Номер скрыт'}</div>

                        {call.client_name ? (
                            <div className="mt-0.5 text-sm text-gray-800">{call.client_name}</div>
                        ) : (
                            <div className="mt-0.5 text-sm text-gray-500">Номер неизвестен</div>
                        )}

                        {/* Кому звонят. На очередь телефон звонит у нескольких
                            сразу, и окно видят все — без фамилии непонятно, чей
                            это разговор. */}
                        {call.ringing_at?.length ? (
                            <div className="mt-1 text-xs text-gray-600">
                                {call.is_queue ? 'Звонок на отдел, телефон звонит у: ' : 'Звонят: '}
                                {call.ringing_at
                                    .map((who) => who.name ?? `добавочный ${who.extension}`)
                                    .join(', ')}
                            </div>
                        ) : null}

                        {call.order_number ? (
                            <>
                                <div className="mt-1 text-sm font-semibold text-gray-900">
                                    Заказ <OrderNumberLink number={call.order_number} />
                                </div>
                                {/* Разговор начался — коротко напоминаем, о чём сделка. */}
                                {call.status === 'answered' && <CallSummary callId={call.telphin_call_id} />}
                            </>
                        ) : (
                            <div className="mt-1">
                                {/* Честно: заказы у клиента есть, просто какой из
                                    них — решает человек. Раньше тут стояло
                                    «Заказов не найдено», и менеджер звонил по
                                    заказу, которого будто бы нет. */}
                                {call.client_orders?.length ? (
                                    <div className="text-sm text-gray-700">
                                        Заказы клиента:{' '}
                                        {call.client_orders.map((order, index) => (
                                            <span key={order.orderId}>
                                                {index > 0 && ', '}
                                                <OrderNumberLink number={order.number} />
                                            </span>
                                        ))}
                                        {' — какой именно, укажите:'}
                                    </div>
                                ) : (
                                    <div className="text-sm text-gray-700">
                                        {call.client_name ? 'Заказов у клиента не нашли' : 'Заказа нет'}
                                    </div>
                                )}
                                <CallOrderPicker
                                    callId={call.telphin_call_id}
                                    onBound={(orderNumber) => setCalls((current) => current.map((item) =>
                                        item.telphin_call_id === call.telphin_call_id
                                            ? { ...item, order_number: orderNumber }
                                            : item))}
                                />
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
