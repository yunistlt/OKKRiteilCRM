'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Предложения Тамары изменить настройку сервиса.
 *
 * Тамара сама ничего не применяет: она находит нужную ручку, объясняет, что
 * изменится, и оставляет карточку здесь. Нажимает владелец — потому что
 * поднятая нагрузка назавтра уезжает живым людям в телегу.
 *
 * Карточка показывает «было → станет» и то, на какие числа Тамара опиралась:
 * решение принимают по данным, а не по формулировке.
 */

export type Proposal = {
    id: number;
    knob_id: string;
    module: string;
    title: string;
    current_value: string | null;
    new_value: string;
    effective_from: string | null;
    reason: string;
    evidence: string | null;
    status: 'pending' | 'applied' | 'rejected' | 'failed';
    created_at: string;
    decided_by: string | null;
    error: string | null;
};

const MODULE_TITLES: Record<string, string> = {
    sales_rop: 'Ежедневные задачи отдела продаж',
    salary: 'Мотивация',
    salary_plan: 'План продаж',
    okk: 'Качество ОКК',
};

export default function SettingProposals({ onApplied }: { onApplied?: () => void }) {
    const [items, setItems] = useState<Proposal[]>([]);
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Предложение, по которому настройка успела измениться: нужен второй вопрос. */
    const [conflict, setConflict] = useState<{ id: number; message: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/shtab/settings-changes?status=pending');
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Предложения не открылись');
            setItems(data.proposals ?? []);
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const decide = useCallback(
        async (id: number, decision: 'apply' | 'reject', force = false) => {
            setBusy(id);
            setError(null);
            setConflict(null);
            try {
                const res = await fetch('/api/shtab/settings-changes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision, force }),
                });
                const data = await res.json();
                if (res.status === 409) {
                    // Настройку изменили после предложения. Не затираем молча:
                    // показываем расхождение и спрашиваем ещё раз.
                    setConflict({ id, message: data?.error || 'Значение изменилось' });
                    return;
                }
                if (!res.ok) throw new Error(data?.error || 'Не применилось');
                await load();
                if (decision === 'apply') onApplied?.();
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setBusy(null);
            }
        },
        [load, onApplied],
    );

    if (items.length === 0 && !error) return null;

    return (
        <div className="proposals">
            {error ? (
                <div className="card" style={{ borderColor: 'var(--signal)' }}>
                    <span className="eyebrow" style={{ color: 'var(--signal)' }}>не вышло</span>
                    <p style={{ marginTop: 6 }}>{error}</p>
                </div>
            ) : null}

            {items.map((p) => (
                <div className="card proposal" key={p.id}>
                    <span className="eyebrow">
                        Тамара предлагает изменить · {MODULE_TITLES[p.module] ?? p.module}
                    </span>

                    <div className="proposal-title">{p.title}</div>

                    <div className="proposal-diff">
                        <span className="proposal-was">{p.current_value || 'не задано'}</span>
                        <span className="proposal-arrow">→</span>
                        <b className="proposal-will">{p.new_value}</b>
                        {p.effective_from ? <span className="hint"> с {p.effective_from}</span> : null}
                    </div>

                    <p className="proposal-reason">{p.reason}</p>
                    {p.evidence ? (
                        <details>
                            <summary className="eyebrow">на чём основано</summary>
                            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)' }}>{p.evidence}</p>
                        </details>
                    ) : null}

                    {conflict?.id === p.id ? (
                        <div className="card" style={{ borderColor: 'var(--signal)', marginTop: 10 }}>
                            <span className="eyebrow" style={{ color: 'var(--signal)' }}>настройка изменилась</span>
                            <p style={{ marginTop: 6, fontSize: 13 }}>{conflict.message}</p>
                            <button
                                className="btn btn-sm btn-primary"
                                style={{ marginTop: 8 }}
                                disabled={busy === p.id}
                                onClick={() => void decide(p.id, 'apply', true)}
                            >
                                всё равно применить
                            </button>
                        </div>
                    ) : null}

                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                        <button
                            className="btn btn-primary"
                            disabled={busy === p.id}
                            onClick={() => void decide(p.id, 'apply')}
                        >
                            {busy === p.id ? 'применяю…' : 'применить'}
                        </button>
                        <button className="btn" disabled={busy === p.id} onClick={() => void decide(p.id, 'reject')}>
                            отклонить
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
