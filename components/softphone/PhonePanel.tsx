'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Phone, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCallNotifications } from '@/lib/hooks/useCallNotifications';
import { DialPad } from './DialPad';
import { ActiveCall } from './ActiveCall';
import { IncomingCallAlert } from './IncomingCallAlert';
import { CallHistory } from './CallHistory';
import PendingActions from '@/components/assistant/PendingActions';

interface ActiveCallState {
  callId: string;
  contactNumber: string;
  contactName?: string;
  status: 'initiating' | 'ringing' | 'connected' | 'completed';
  startedAt?: Date;
}

interface IncomingCallState {
  callId: string;
  fromNumber: string;
  clientName?: string;
  orderNumber?: string;
}

type DialOrder = { orderId: number; number: string; status: string | null };

export function PhonePanel() {
  const { user } = useAuth();
  const managerId = user?.retail_crm_manager_id ?? null;

  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Какой заказ выбрать перед набором: у номера их несколько. */
  const [askOrder, setAskOrder] = useState<{ phone: string; orders: DialOrder[] } | null>(null);

  const { subscribeToUpdates } = useCallNotifications();

  useEffect(() => {
    return subscribeToUpdates((event) => {
      if (event.type === 'incoming_call') {
        setIncomingCall({
          callId: event.callId,
          fromNumber: event.data?.phone,
          clientName: event.data?.client_name,
          orderNumber: event.data?.order_number,
        });
        setIsOpen(true);
        return;
      }

      if (event.type === 'call_status_update') {
        const status = String(event.data?.status || '');

        setActiveCall((prev) => {
          if (!prev || prev.callId !== event.callId) return prev;
          if (['completed', 'failed', 'missed', 'busy', 'no_answer', 'cancelled'].includes(status)) {
            return null;
          }
          if (status === 'connected') {
            return { ...prev, status: 'connected', startedAt: prev.startedAt ?? new Date() };
          }
          return prev;
        });

        setIncomingCall((prev) => (prev && prev.callId === event.callId && status !== 'ringing' ? null : prev));
      }
    });
  }, [subscribeToUpdates]);

  /**
   * Набор с указанием заказа.
   *
   * Решение владельца 15.10.2026: набрать «в никуда» нельзя — привязка
   * приходит вместе с набором, после разговора её взять неоткуда. Один заказ
   * подставляем молча, несколько — спрашиваем, ни одного — звоним без заказа
   * (новый клиент, поставщик).
   */
  const call = useCallback(
    async (phoneNumber: string, orderId: number | null) => {
      try {
        const response = await fetch('/api/calls/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber, managerId, orderId }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Не удалось начать звонок');
        }

        setActiveCall({
          callId: data.callSid,
          contactNumber: phoneNumber,
          status: 'initiating',
        });

        if (data.mock) {
          setError(data.mockReason || 'Демо-режим: реальный звонок не совершён.');
        }
        setAskOrder(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось начать звонок');
      }
    },
    [managerId]
  );

  const handleInitiateCall = useCallback(
    async (phoneNumber: string) => {
      setError(null);
      setAskOrder(null);

      if (!managerId) {
        setError('К вашей учётной записи не привязан менеджер RetailCRM — позвонить нельзя.');
        return;
      }

      let orders: DialOrder[] = [];
      try {
        const res = await fetch(`/api/calls/orders-by-phone?phone=${encodeURIComponent(phoneNumber)}`);
        const payload = await res.json();
        if (res.ok) orders = payload.orders || [];
      } catch {
        // Заказы не посмотрелись — звонок важнее, набираем без привязки.
      }

      // Заказ один — спрашивать нечего, он и есть ответ.
      if (orders.length === 1) {
        await call(phoneNumber, orders[0].orderId);
        return;
      }
      if (orders.length === 0) {
        await call(phoneNumber, null);
        return;
      }

      setAskOrder({ phone: phoneNumber, orders });
    },
    [managerId, call]
  );

  const handleAnswerCall = () => {
    if (!incomingCall) return;
    setActiveCall({
      callId: incomingCall.callId,
      contactNumber: incomingCall.fromNumber,
      contactName: incomingCall.clientName,
      status: 'connected',
      startedAt: new Date(),
    });
    setIncomingCall(null);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-ui-audit-zone="phone"
        // В мессенджере на телефоне своя шапка с кнопками — не наезжаем на неё.
        // На «Моём дне» кнопки телефона нет: экран про одно следующее действие,
        // а звонок начинается из карточки заказа (требование владельца 01.10.2026).
        className={`fixed right-16 top-3 z-[60] items-center gap-2 bg-gray-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600 ${
            pathname.startsWith('/analytics')
                ? 'hidden'
                : pathname.startsWith('/messenger')
                    ? 'hidden md:flex'
                    : 'flex'
        }`}
      >
        <Phone size={16} />
        Телефон
        {incomingCall && <span className="bg-red-600 px-1.5 py-0.5 text-[10px]">Звонок</span>}
      </button>
    );
  }

  return (
    // Телефон занимает только верх правой колонки: чат с Семёном должен
    // оставаться доступен во время разговора — менеджер спрашивает у него
    // прямо при клиенте (требование владельца 30.09.2026).
    <aside
      data-ui-audit-zone="phone"
      className="fixed right-0 top-0 z-[130] flex max-h-[60vh] w-80 flex-col border-b border-l border-gray-200 bg-white shadow-none"
    >
      <div className="flex items-center justify-between bg-gray-900 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
          <Phone size={14} />
          Телефон
        </span>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label="Свернуть панель телефона"
          className="text-white hover:text-blue-300"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {incomingCall && (
          <IncomingCallAlert
            call={incomingCall}
            onAnswer={handleAnswerCall}
            onReject={() => setIncomingCall(null)}
          />
        )}

        {activeCall && <ActiveCall call={activeCall} onEndCall={() => setActiveCall(null)} />}

        {/* Что помощник приготовил: письмо или звонок уйдут только по нажатию человека. */}
        <PendingActions />


        {error && (
          <p className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            {error}
          </p>
        )}

        {/* Заказ спрашиваем до гудка: после разговора привязку взять неоткуда
            (решение владельца 15.10.2026). */}
        {askOrder && (
          <div className="border-b border-gray-200 bg-amber-50 px-3 py-2">
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
              По какому заказу звоните на {askOrder.phone}?
            </div>
            <div className="max-h-40 overflow-auto">
              {askOrder.orders.map((order) => (
                <button
                  key={order.orderId}
                  type="button"
                  onClick={() => void call(askOrder.phone, order.orderId)}
                  className="block w-full border-b border-amber-200 px-1 py-1.5 text-left text-xs hover:bg-amber-100"
                >
                  <span className="font-semibold text-gray-900">{order.number}</span>
                  {order.status && <span className="ml-2 text-gray-600">{order.status}</span>}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void call(askOrder.phone, null)}
                className="border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
              >
                Позвонить без заказа
              </button>
              <button
                type="button"
                onClick={() => setAskOrder(null)}
                className="px-1 text-[11px] text-gray-500 hover:text-gray-900"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        <DialPad
          onInitiateCall={handleInitiateCall}
          disabled={!managerId}
          disabledReason="К вашей учётной записи не привязан менеджер RetailCRM — позвонить нельзя."
        />

        <CallHistory />
      </div>
    </aside>
  );
}
