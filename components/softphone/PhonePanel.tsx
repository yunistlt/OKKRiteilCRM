'use client';

import { useCallback, useEffect, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCallNotifications } from '@/lib/hooks/useCallNotifications';
import { DialPad } from './DialPad';
import { ActiveCall } from './ActiveCall';
import { IncomingCallAlert } from './IncomingCallAlert';
import { CallHistory } from './CallHistory';

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

export function PhonePanel() {
  const { user } = useAuth();
  const managerId = user?.retail_crm_manager_id ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleInitiateCall = useCallback(
    async (phoneNumber: string) => {
      setError(null);

      if (!managerId) {
        setError('К вашей учётной записи не привязан менеджер RetailCRM — позвонить нельзя.');
        return;
      }

      try {
        const response = await fetch('/api/calls/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber, managerId }),
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось начать звонок');
      }
    },
    [managerId]
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
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-gray-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600"
      >
        <Phone size={16} />
        Телефон
        {incomingCall && <span className="bg-red-600 px-1.5 py-0.5 text-[10px]">Звонок</span>}
      </button>
    );
  }

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-screen w-80 flex-col border-l border-gray-200 bg-white">
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

        {error && (
          <p className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            {error}
          </p>
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
