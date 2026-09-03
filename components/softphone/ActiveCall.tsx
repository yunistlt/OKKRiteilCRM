'use client';

import { useState, useEffect } from 'react';
import { PhoneOff } from 'lucide-react';

interface ActiveCallProps {
  call: {
    callId: string;
    contactNumber: string;
    contactName?: string;
    status: 'initiating' | 'ringing' | 'connected' | 'completed';
    startedAt?: Date;
  };
  onEndCall: () => void;
}

const STATUS_LABELS: Record<ActiveCallProps['call']['status'], string> = {
  initiating: 'Набираем номер',
  ringing: 'Соединяем',
  connected: 'Разговор идёт',
  completed: 'Звонок завершён',
};

export function ActiveCall({ call, onEndCall }: ActiveCallProps) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (call.status !== 'connected' || !call.startedAt) return;

    const tick = () => {
      setDuration(Math.floor((Date.now() - call.startedAt!.getTime()) / 1000));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call.status, call.startedAt]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="border-b border-gray-200">
      <div className="bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">
        {STATUS_LABELS[call.status]}
      </div>

      <div className="px-3 py-3">
        <div className="text-base font-black text-gray-900">
          {call.contactName || call.contactNumber}
        </div>
        {call.contactName && (
          <div className="font-mono text-xs text-gray-600">{call.contactNumber}</div>
        )}

        {call.status === 'connected' && (
          <div className="mt-2 font-mono text-2xl font-black text-gray-900">
            {formatDuration(duration)}
          </div>
        )}

        <p className="mt-2 text-[11px] leading-snug text-gray-500">
          Разговор идёт на вашем телефоне. Управление звуком — на аппарате.
        </p>
      </div>

      <button
        onClick={onEndCall}
        className="flex w-full items-center justify-center gap-1.5 border-t border-gray-200 bg-white px-2 py-2 text-xs font-bold text-red-600 hover:bg-red-600 hover:text-white"
      >
        <PhoneOff size={14} />
        Убрать с экрана
      </button>
    </div>
  );
}
