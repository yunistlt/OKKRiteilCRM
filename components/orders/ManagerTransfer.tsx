'use client';

/**
 * Передача заказа другому менеджеру — прямо в карточке, с обязательной
 * причиной (решение владельца 05.10.2026).
 *
 * Причина не формальность: возможность временная, и по накопленным причинам
 * будем учить систему раздавать заказы правильно сразу. Поэтому короткое
 * «надо» не принимается — просим предложение.
 */
import { useEffect, useState } from 'react';

type Manager = { id: number; name: string };

export default function ManagerTransfer({
    orderKey,
    currentManagerId,
    currentManagerName,
    onDone,
}: {
    orderKey: number | string;
    currentManagerId?: number | string | null;
    currentManagerName?: string | null;
    onDone?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [toManagerId, setToManagerId] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (!open || managers.length) return;
        fetch('/api/okk/managers')
            .then((r) => r.json())
            .then((list) => setManagers(Array.isArray(list) ? list : []))
            .catch(() => setNote('Список менеджеров не загрузился'));
    }, [open, managers.length]);

    const submit = async () => {
        setSaving(true);
        setNote(null);
        try {
            const res = await fetch(`/api/orders/${orderKey}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toManagerId: Number(toManagerId), reason }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось передать заказ');
            setNote(`Заказ передан: ${payload.manager}`);
            setReason('');
            setToManagerId('');
            setOpen(false);
            onDone?.();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSaving(false);
        }
    };

    const others = managers.filter((m) => String(m.id) !== String(currentManagerId ?? ''));

    return (
        <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <span>Менеджер</span>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="text-blue-600 hover:underline normal-case"
                >
                    {open ? 'Отменить' : 'Передать'}
                </button>
            </div>
            <div className="border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-900">
                {currentManagerName || 'Не назначен'}
            </div>

            {open && (
                <div className="space-y-2 border border-gray-200 bg-white p-2">
                    <select
                        value={toManagerId}
                        onChange={(e) => setToManagerId(e.target.value)}
                        className="w-full border border-gray-300 px-2 py-1 text-sm"
                    >
                        <option value="">Кому передать</option>
                        {others.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        placeholder="Почему передаёте: дубль заявки, постоянный клиент этого менеджера, очередь…"
                        className="w-full border border-gray-300 px-2 py-1 text-sm"
                    />
                    <button
                        type="button"
                        disabled={saving || !toManagerId || reason.trim().length < 10}
                        onClick={submit}
                        className="w-full bg-blue-600 px-2 py-1 text-sm text-white disabled:bg-gray-300"
                    >
                        {saving ? 'Передаём…' : 'Передать заказ'}
                    </button>
                </div>
            )}

            {note && <div className="text-xs text-gray-600">{note}</div>}
        </div>
    );
}
