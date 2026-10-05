'use client';
import OrderNumberLink from '@/components/ui/OrderNumberLink';

import { useCallback, useEffect, useState } from 'react';

interface PendingAction {
    id: string;
    kind: 'email' | 'call';
    preview: string;
    order_number: string | null;
    created_at: string;
}

const KIND_LABELS: Record<PendingAction['kind'], { title: string; confirm: string }> = {
    email: { title: 'Письмо клиенту', confirm: 'Отправить' },
    call: { title: 'Звонок клиенту', confirm: 'Звонить' },
};

/**
 * Что помощник приготовил и ждёт вашего решения.
 *
 * Письмо и звонок — выход наружу: отменить их после отправки нельзя. Поэтому
 * помощник только собирает действие, а выполняется оно отсюда, по нажатию человека.
 */
export default function PendingActions() {
    const [actions, setActions] = useState<PendingAction[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/assistant/actions');
            const data = await res.json();
            if (!res.ok) return;
            setActions(data.actions || []);
            setUnavailableReason(data.unavailableReason || null);
        } catch {
            // Молча: это фоновая проверка, ломать ею экран нельзя.
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 15000);
        return () => clearInterval(interval);
    }, [load]);

    const decide = async (id: string, decision: 'confirm' | 'cancel') => {
        setBusyId(id);
        setMessage(null);
        try {
            const res = await fetch('/api/assistant/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionId: id, decision }),
            });
            const data = await res.json();
            setMessage(data.message || (res.ok ? 'Готово.' : 'Не получилось.'));
            await load();
        } catch {
            setMessage('Не получилось — попробуйте ещё раз.');
        } finally {
            setBusyId(null);
        }
    };

    if (unavailableReason) {
        return (
            <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                {unavailableReason}
            </div>
        );
    }

    if (actions.length === 0) {
        return message ? (
            <div className="border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">{message}</div>
        ) : null;
    }

    return (
        <div className="border-b border-gray-200">
            <div className="bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">
                Помощник ждёт подтверждения
            </div>

            {actions.map((action) => (
                <div key={action.id} className="border-b border-gray-200 px-3 py-2 last:border-b-0">
                    <div className="text-xs font-bold text-gray-900">
                        {KIND_LABELS[action.kind].title}
                        {action.order_number ? <> · заказ <OrderNumberLink number={action.order_number} /></> : ''}
                    </div>

                    <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[11px] leading-snug text-gray-700">
                        {action.preview}
                    </pre>

                    <div className="mt-2 grid grid-cols-2 gap-px bg-gray-200">
                        <button
                            onClick={() => decide(action.id, 'cancel')}
                            disabled={busyId === action.id}
                            className="bg-white px-2 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-900 hover:text-white disabled:text-gray-300"
                        >
                            Отменить
                        </button>
                        <button
                            onClick={() => decide(action.id, 'confirm')}
                            disabled={busyId === action.id}
                            className="bg-green-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-500"
                        >
                            {busyId === action.id ? 'Выполняем…' : KIND_LABELS[action.kind].confirm}
                        </button>
                    </div>
                </div>
            ))}

            {message && <div className="bg-gray-50 px-3 py-2 text-[11px] text-gray-600">{message}</div>}
        </div>
    );
}
