'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/utils/supabase-browser';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import CallOrderPicker from '@/components/orders/CallOrderPicker';

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
};

export default function RingingCallAlert() {
    const [calls, setCalls] = useState<Ringing[]>([]);

    const drop = useCallback((callId: string) => {
        setCalls((current) => current.filter((row) => row.telphin_call_id !== callId));
    }, []);

    useEffect(() => {
        const supabase = getSupabaseBrowser();
        if (!supabase) return;

        // Звонок мог начаться за секунду до того, как человек открыл вкладку.
        let cancelled = false;
        void supabase
            .from('active_calls')
            .select('telphin_call_id, direction, from_number, client_name, order_number, status, started_at')
            .eq('status', 'ringing')
            .gte('started_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
            .then(({ data }) => {
                if (!cancelled && data) setCalls(data as Ringing[]);
            });

        const channel = supabase
            .channel('active-calls')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'active_calls' }, (payload: any) => {
                const row = (payload.new ?? payload.old) as Ringing | undefined;
                if (!row?.telphin_call_id) return;

                // Трубку подняли или звонок кончился — окно убираем.
                if (payload.eventType === 'DELETE' || row.status !== 'ringing') {
                    drop(row.telphin_call_id);
                    return;
                }

                setCalls((current) => {
                    const rest = current.filter((item) => item.telphin_call_id !== row.telphin_call_id);
                    return [row, ...rest].slice(0, 3);
                });
            })
            .subscribe();

        return () => {
            cancelled = true;
            void supabase.removeChannel(channel);
        };
    }, [drop]);

    if (!calls.length) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[300] flex w-96 flex-col gap-2">
            {calls.map((call) => (
                <div key={call.telphin_call_id} className="border-2 border-green-600 bg-white shadow-xl">
                    <div className="flex items-center justify-between bg-green-700 px-3 py-2">
                        <span className="text-xs font-black uppercase tracking-widest text-white">
                            {call.direction === 'outgoing' ? 'Идёт звонок' : 'Звонят вам'}
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
                            <div className="mt-1 text-sm font-semibold text-gray-900">
                                Заказ <OrderNumberLink number={call.order_number} />
                            </div>
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
