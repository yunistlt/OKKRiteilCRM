'use client';

import { useState } from 'react';
import { Phone, Loader } from 'lucide-react';

interface CallInitiatorProps {
  phoneNumber: string;
  managerId: string;
  orderId?: string;
  customerName?: string;
}

export default function CallInitiator({
  phoneNumber,
  managerId,
  orderId,
  customerName,
}: CallInitiatorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const initiateCall = async () => {
    setIsLoading(true);
    setStatus('calling');
    setErrorMessage('');

    try {
      const response = await fetch('/api/calls/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber,
          managerId,
          orderId,
        }),
      });

      let data: any = null;

      try {
        data = await response.json();
      } catch (parseError) {
        console.warn('Failed to parse call initiation response:', parseError);
      }

      if (!response.ok) {
        const apiError =
          typeof data?.error === 'string'
            ? data.error
            : typeof data?.error?.message === 'string'
            ? data.error.message
            : data?.details
            ? JSON.stringify(data.details)
            : null;

        throw new Error(apiError || 'Failed to initiate call');
      }

      setStatus('success');
      if (data?.callSid) {
        console.log('✅ Call initiated:', data.callSid);
      }

      // Сбросим статус через 3 секунды
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      console.error('Call initiation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={initiateCall}
        disabled={isLoading || status === 'calling'}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-lg font-medium
          transition-all duration-300 w-fit
          ${status === 'success'
            ? 'bg-green-500 text-white'
            : status === 'error'
            ? 'bg-red-500 text-white'
            : isLoading || status === 'calling'
            ? 'bg-blue-600 text-white'
            : 'bg-blue-500 hover:bg-blue-600 text-white active:scale-95'
          }
          disabled:opacity-70 disabled:cursor-not-allowed
        `}
        title={`Позвонить ${customerName || phoneNumber}`}
      >
        {isLoading || status === 'calling' ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <Phone className="w-4 h-4" />
        )}
        {status === 'success' ? 'Звонок инициирован!' : 'Позвонить'}
      </button>

      {errorMessage && (
        <div className="text-red-500 text-xs md:text-sm max-w-sm">
          Ошибка: {errorMessage}
        </div>
      )}
    </div>
  );
}
