'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Предложения Тамары создать объявление в Яндекс Директе.
 *
 * Сама она объявлений не создаёт. Причина та же, что у настроек, только
 * дороже: реклама тратит настоящие деньги, и цена неверно понятой фразы
 * измеряется в рублях.
 *
 * Карточка показывает объявление ровно так, как его увидит человек в выдаче, —
 * решение принимают по тексту, а не по описанию текста. Рядом стоит то, на
 * каких числах Тамара его построила.
 *
 * После нажатия объявление кладётся ЧЕРНОВИКОМ: на модерацию не уходит и
 * показов не получает, пока владелец сам не отправит его в Директе. Это второй
 * предохранитель — на случай, если первый нажали не думая.
 */

export type AdProposal = {
    id: number;
    ad_group_id: number;
    campaign_name: string | null;
    ad_group_name: string | null;
    title: string;
    title2: string | null;
    body: string;
    href: string;
    keywords: string | null;
    reason: string;
    evidence: string | null;
    status: 'pending' | 'created' | 'rejected' | 'failed';
    direct_ad_id: number | null;
    error: string | null;
    sandbox: boolean;
    created_at: string;
};

export default function AdProposals() {
    const [items, setItems] = useState<AdProposal[]>([]);
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Что вышло из последнего нажатия: номер объявления или отказ Директа. */
    const [done, setDone] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/shtab/ad-drafts');
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Предложения не открылись');
            setItems((data.proposals ?? []).filter((p: AdProposal) => p.status === 'pending'));
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const decide = useCallback(
        async (id: number, decision: 'create' | 'reject') => {
            setBusy(id);
            setError(null);
            setDone(null);
            try {
                const res = await fetch('/api/shtab/ad-drafts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'Не вышло');
                if (decision === 'create') {
                    setDone(
                        data.ad_id
                            ? `Объявление ${data.ad_id} создано черновиком. Показов у него нет: отправь его на модерацию в Директе, когда решишь.`
                            : `Директ не создал объявление: ${data.error ?? 'причина не названа'}`,
                    );
                }
                await load();
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setBusy(null);
            }
        },
        [load],
    );

    if (items.length === 0 && !error && !done) return null;

    return (
        <div className="proposals">
            {error ? (
                <div className="card" style={{ borderColor: 'var(--signal)' }}>
                    <span className="eyebrow" style={{ color: 'var(--signal)' }}>не вышло</span>
                    <p style={{ marginTop: 6 }}>{error}</p>
                </div>
            ) : null}

            {done ? (
                <div className="card">
                    <span className="eyebrow">Директ</span>
                    <p style={{ marginTop: 6 }}>{done}</p>
                </div>
            ) : null}

            {items.map((p) => (
                <div className="card proposal" key={p.id}>
                    <span className="eyebrow">
                        Тамара предлагает объявление
                        {p.sandbox ? ' · ПЕСОЧНИЦА, не боевой кабинет' : ''}
                    </span>

                    {/* Объявление показано так, как его увидит человек в выдаче:
                        по тексту и решают, а не по описанию текста. */}
                    <div className="ad-preview">
                        <div className="ad-preview-title">
                            {p.title}
                            {p.title2 ? <span className="ad-preview-title2"> — {p.title2}</span> : null}
                        </div>
                        <div className="ad-preview-href">{p.href}</div>
                        <div className="ad-preview-text">{p.body}</div>
                    </div>

                    <p className="proposal-reason">{p.reason}</p>

                    {p.keywords ? (
                        <p className="hint" style={{ marginTop: 6 }}>
                            Фразы, под которые написано: {p.keywords}. В Директ они не ставятся — это отдельное
                            действие, оно меняет расход.
                        </p>
                    ) : null}

                    {p.evidence ? (
                        <details>
                            <summary className="eyebrow">на чём основано</summary>
                            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)' }}>{p.evidence}</p>
                        </details>
                    ) : null}

                    <p className="hint" style={{ marginTop: 8 }}>
                        Ляжет черновиком в группу {p.ad_group_name ?? p.ad_group_id}. На модерацию не уйдёт и показов
                        не получит, пока ты сам не отправишь его в Директе.
                    </p>

                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                        <button
                            className="btn btn-primary"
                            disabled={busy === p.id}
                            onClick={() => void decide(p.id, 'create')}
                        >
                            {busy === p.id ? 'создаю…' : 'создать черновиком'}
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
