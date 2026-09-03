'use client';

import { Phone, PhoneOff } from 'lucide-react';

interface IncomingCallAlertProps {
  call: {
    callId: string;
    fromNumber: string;
    clientName?: string;
    orderNumber?: string;
  };
  onAnswer: () => void;
  onReject: () => void;
}

export function IncomingCallAlert({ call, onAnswer, onReject }: IncomingCallAlertProps) {
  return (
    <div className="border-b-2 border-blue-600 bg-blue-50">
      <div className="bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">
        Входящий звонок
      </div>

      <div className="px-3 py-3">
        <div className="text-base font-black text-gray-900">
          {call.clientName || call.fromNumber}
        </div>
        {call.clientName && (
          <div className="font-mono text-xs text-gray-600">{call.fromNumber}</div>
        )}

        {call.orderNumber && (
          <div className="mt-2 border border-blue-200 bg-white px-2 py-1">
            <span className="text-[10px] font-black uppercase text-gray-400">Заказ</span>
            <div className="text-xs font-bold text-gray-900">№ {call.orderNumber}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px bg-gray-200">
        <button
          onClick={onReject}
          className="flex items-center justify-center gap-1.5 bg-white px-2 py-2 text-xs font-bold text-red-600 hover:bg-red-600 hover:text-white"
        >
          <PhoneOff size={14} />
          Отклонить
        </button>
        <button
          onClick={onAnswer}
          className="flex items-center justify-center gap-1.5 bg-green-600 px-2 py-2 text-xs font-bold text-white hover:bg-green-700"
        >
          <Phone size={14} />
          Ответить
        </button>
      </div>
    </div>
  );
}
