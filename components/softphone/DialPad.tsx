'use client';

import { useState } from 'react';
import { Phone, Delete } from 'lucide-react';

interface DialPadProps {
  onInitiateCall: (phoneNumber: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function DialPad({ onInitiateCall, disabled, disabledReason }: DialPadProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleCall = async () => {
    if (!phoneNumber.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await onInitiateCall(phoneNumber);
      setPhoneNumber('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-3">
      <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">
        Номер для звонка
      </label>
      <input
        type="tel"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        placeholder="+7 999 000-00-00"
        className="w-full border border-gray-300 px-2 py-2 text-center font-mono text-lg focus:border-blue-600 focus:outline-none"
      />

      <div className="mt-2 grid grid-cols-3 gap-px bg-gray-200">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhoneNumber((prev) => prev + key)}
            className="bg-white py-2 text-base font-bold text-gray-900 hover:bg-blue-600 hover:text-white"
          >
            {key}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPhoneNumber((prev) => prev.slice(0, -1))}
        className="mt-2 flex w-full items-center justify-center gap-1.5 border border-gray-300 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-900 hover:text-white"
      >
        <Delete size={14} />
        Стереть цифру
      </button>

      <button
        type="button"
        onClick={handleCall}
        disabled={!phoneNumber.trim() || isLoading || disabled}
        className="mt-2 flex w-full items-center justify-center gap-1.5 bg-green-600 py-2.5 text-sm font-black text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-500"
      >
        <Phone size={16} />
        {isLoading ? 'Набираем номер…' : 'Позвонить'}
      </button>

      {disabled && disabledReason && (
        <p className="mt-2 border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
          {disabledReason}
        </p>
      )}
    </div>
  );
}
