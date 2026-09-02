'use client';

import { useMemo, useState } from 'react';
import { SOURCE_TITLES, closedByRazbor, topArea } from '@/lib/shtab/types';
import type { ShtabArea } from '@/lib/shtab/types';
import { guessArea } from '@/lib/shtab/checks';
import type { ViewProps } from '../nav';

export default function Minus({ shtab, go }: ViewProps) {
    const { state, addMinus, toggleMinus, newRazbor } = shtab;
    const [text, setText] = useState('');
    // Область подсказывается по тексту, но остаётся полем выбора: подсказка
    // ошибается, и переучивать владельца под неё нельзя.
    const [areaOverride, setAreaOverride] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const guessed = useMemo(() => guessArea(text), [text]);
    const areaCode = areaOverride ?? guessed;
    // null — область ещё не трогали руками, раскрыта приоритетная.
    const [opened, setOpened] = useState<string | null>(null);

    if (!state) return null;
    const top = topArea(state.areas, state.minuses);
    const max = Math.max(1, top.count);

    const sorted: ShtabArea[] = [...state.areas].sort(
        (a, b) => top.counts[b.code] - top.counts[a.code] || a.ordinal - b.ordinal,
    );

    const submit = async () => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        try {
            await addMinus(trimmed, areaCode);
            setText('');
            setAreaOverride(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const startRazbor = async (code: string) => {
        await newRazbor(code);
        go('razbor');
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Приоритет считается, а не назначается</div>
                <h1>Минусы</h1>
                <p>
                    Всё, что нелогично в компании, — в одном реестре, по всем областям. Область с наибольшим числом
                    минусов и есть приоритет: именно там сидит то, что порождает остальное.
                </p>
            </div>

            <div className="card" style={{ marginBottom: 18 }}>
                <div className="eyebrow" style={{ marginBottom: 11 }}>
                    Завести минус
                </div>
                <div className="field" style={{ marginBottom: 11 }}>
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                        placeholder="Что нелогично? Например: заказы простаивают перед окраской по два дня"
                    />
                    <div className="hint">Тамара определит область по тексту — поправь, если промахнулась.</div>
                </div>
                <div className="row">
                    <select
                        value={areaCode}
                        onChange={(e) => setAreaOverride(e.target.value)}
                        style={{ width: 'auto', minWidth: 240 }}
                    >
                        {state.areas.map((a) => (
                            <option key={a.code} value={a.code}>
                                {a.title}
                            </option>
                        ))}
                    </select>
                    <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>
                        Добавить в реестр
                    </button>
                </div>
                {error ? <div className="mark m-bad">{error}</div> : null}
            </div>

            <div className="areas">
                {sorted.map((area) => {
                    const n = top.counts[area.code] ?? 0;
                    const items = state.minuses.filter((m) => m.area_code === area.code);
                    const isTop = area.code === top.area?.code && n > 0;
                    const isOpen = opened === null ? isTop : opened === area.code;
                    return (
                        <div key={area.code} className={`area${isTop ? ' top' : ''}${isOpen ? ' open' : ''}`}>
                            <button
                                className="area-hd"
                                aria-expanded={isOpen}
                                onClick={() => setOpened(isOpen ? '' : area.code)}
                            >
                                <span className="area-name">{area.title}</span>
                                <span className="area-bar">
                                    <i style={{ width: `${((n / max) * 100).toFixed(0)}%` }} />
                                </span>
                                <span className="area-n">{n}</span>
                            </button>
                            <div className="area-body">
                                <ul className="mlist">
                                    {items.length === 0 ? (
                                        <li style={{ gridTemplateColumns: '1fr' }}>
                                            <span style={{ color: 'var(--ink-3)' }}>Минусов не зафиксировано</span>
                                        </li>
                                    ) : (
                                        items.map((m) => {
                                            const by = m.done ? closedByRazbor(m.id, state.razbory) : null;
                                            return (
                                            <li key={m.id} className={m.done ? 'done' : ''}>
                                                <span className="mt">
                                                    {m.text}
                                                    {by ? (
                                                        <small style={{ display: 'block', color: 'var(--calm)' }}>
                                                            закрыт стратегией от{' '}
                                                            {new Date(by.created_at).toLocaleDateString('ru-RU', {
                                                                day: '2-digit',
                                                                month: 'short',
                                                            })}
                                                        </small>
                                                    ) : null}
                                                </span>
                                                <span className={`src ${m.source === 'data' ? 'auto' : ''}`}>
                                                    {SOURCE_TITLES[m.source]}
                                                </span>
                                                <button
                                                    className="btn btn-sm btn-danger"
                                                    onClick={() => void toggleMinus(m)}
                                                >
                                                    {m.done ? 'вернуть' : 'закрыт'}
                                                </button>
                                            </li>
                                            );
                                        })
                                    )}
                                </ul>
                                <div className="area-acts">
                                    <button className="btn btn-sm" onClick={() => void startRazbor(area.code)}>
                                        Разобрать эту область
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
