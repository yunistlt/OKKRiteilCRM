'use client';

// Документы на согласовании: юрист читает договор, правит текст и решает —
// согласовать или вернуть менеджеру. Строка = один договор по заказу.
import { useCallback, useEffect, useState } from 'react';

type Contract = {
    id: number;
    order_number: string;
    title: string;
    status: string;
    statusLabel: string;
    version: number;
    terms_text: string | null;
    body_text: string | null;
    created_by: string | null;
    created_at: string;
    reviewed_by: string | null;
    review_comment: string | null;
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function ApprovalsClient() {
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [statuses, setStatuses] = useState<Array<{ code: string; label: string }>>([]);
    const [status, setStatus] = useState('on_review');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/legal/contracts/approvals?status=${status}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось получить список');
            setContracts(data.contracts || []);
            setStatuses(data.statuses || []);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => {
        void load();
    }, [load]);

    const open = (row: Contract) => {
        setOpenId(row.id);
        setDraft(row.body_text || '');
        setComment('');
        setNote(null);
    };

    const act = async (action: 'approve' | 'rework' | 'revise') => {
        if (openId == null) return;
        setSaving(true);
        setNote(null);
        try {
            const res = await fetch('/api/legal/contracts/approvals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractId: openId,
                    action,
                    comment: comment.trim() || null,
                    bodyText: action === 'revise' ? draft : null,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не получилось');
            setNote(data.note || 'Готово');
            if (action !== 'revise') setOpenId(null);
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSaving(false);
        }
    };

    const current = contracts.find((c) => c.id === openId) || null;

    return (
        <div className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Документы на согласовании</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Договоры по заказам: менеджер составил — юрист читает, правит и согласовывает.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {statuses.map((s) => (
                        <button
                            key={s.code}
                            type="button"
                            onClick={() => setStatus(s.code)}
                            className={`px-3 py-1.5 text-sm font-semibold ${
                                status === s.code ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => setStatus('all')}
                        className={`px-3 py-1.5 text-sm font-semibold ${
                            status === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200'
                        }`}
                    >
                        Все
                    </button>
                </div>
            </div>

            {error && <p className="mb-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {loading && <p className="text-sm text-gray-500">Загружаю…</p>}

            {!loading && contracts.length === 0 && (
                <p className="bg-white px-4 py-6 text-sm text-gray-500">Документов здесь пока нет.</p>
            )}

            <div className="space-y-2">
                {contracts.map((row) => (
                    <div key={row.id} className="bg-white border border-gray-200">
                        <button type="button" onClick={() => (openId === row.id ? setOpenId(null) : open(row))} className="block w-full px-4 py-3 text-left">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-gray-900">{row.title}</span>
                                <span className="text-xs font-semibold text-gray-600">{row.statusLabel} · редакция {row.version}</span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                                Заказ {row.order_number} · составил {row.created_by || '—'} · {formatDate(row.created_at)}
                            </div>
                            {row.terms_text && (
                                <div className="mt-1 text-xs text-gray-600">Условия от менеджера: {row.terms_text}</div>
                            )}
                            {row.review_comment && (
                                <div className="mt-1 text-xs text-gray-600">Замечание юриста: {row.review_comment}</div>
                            )}
                        </button>

                        {openId === row.id && current && (
                            <div className="border-t border-gray-200 px-4 py-3">
                                <textarea
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    rows={20}
                                    className="w-full border border-gray-200 px-3 py-2 font-mono text-xs leading-relaxed"
                                />
                                <input
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="Комментарий: что поправили или почему возвращаете"
                                    className="mt-2 w-full border border-gray-200 px-3 py-2 text-sm"
                                />
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button type="button" disabled={saving} onClick={() => act('revise')} className="bg-white border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50">
                                        Сохранить правку
                                    </button>
                                    <button type="button" disabled={saving} onClick={() => act('approve')} className="bg-green-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                        Согласовать
                                    </button>
                                    <button type="button" disabled={saving} onClick={() => act('rework')} className="bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                        Вернуть на доработку
                                    </button>
                                    {note && <span className="text-sm text-gray-600">{note}</span>}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
