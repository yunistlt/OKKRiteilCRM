'use client';

/**
 * Кнопка «Звонок» рядом с полем телефона в карточке заказа.
 *
 * Набирает ровно то, что сейчас в поле: менеджер часто правит номер прямо в
 * карточке (клиент продиктовал другой) и звонит по нему, не сохраняя заказ
 * (требование владельца 01.10.2026).
 */
import { useState } from 'react';
import { Phone, Loader } from 'lucide-react';

export default function PhoneFieldCall({
    phone,
    managerId,
    orderId,
}: {
    phone: string;
    managerId: string | null;
    orderId: string;
}) {
    const [state, setState] = useState<'idle' | 'calling' | 'done'>('idle');
    const [error, setError] = useState<string | null>(null);

    const digits = (phone || '').replace(/\D/g, '');
    const ready = digits.length >= 6 && Boolean(managerId);

    const call = async () => {
        setError(null);
        setState('calling');
        try {
            const response = await fetch('/api/calls/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone.trim(), managerId, orderId }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Звонок не пошёл');
            }
            setState('done');
            setTimeout(() => setState('idle'), 4000);
        } catch (e) {
            setState('idle');
            setError(e instanceof Error ? e.message : 'Звонок не пошёл');
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={call}
                disabled={!ready || state === 'calling'}
                title={
                    !managerId
                        ? 'К вашей учётной записи не привязан менеджер — позвонить нельзя'
                        : !digits || digits.length < 6
                            ? 'В поле нет номера'
                            : `Позвонить на ${phone}`
                }
                className="flex shrink-0 items-center gap-1 bg-gray-900 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-600 disabled:opacity-30"
            >
                {state === 'calling' ? <Loader size={12} className="animate-spin" /> : <Phone size={12} />}
                {state === 'done' ? 'Набираем' : 'Звонок'}
            </button>
            {error && <p className="mt-1 w-full text-[11px] text-amber-700">{error}</p>}
        </>
    );
}
