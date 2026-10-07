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
};

/** Как часто спрашиваем о звонках. Звонок звонит 20–30 секунд. */
const POLL_MS = 2_000;

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
            if (!cancelled) timer = setTimeout(() => void check(), POLL_MS);
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
                                <div className="text-sm text-gray-700">
                                    {call.client_name ? 'Заказов не найдено' : 'Заказа нет'}
                                </div>
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
