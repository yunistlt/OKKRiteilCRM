'use client';

import { useEffect, useState } from 'react';
import { STRATEGY_DRAFT_NOTE, buildStrategyDraft } from '@/lib/shtab/strategy';
import type { ViewProps } from '../nav';

export default function Strat({ shtab, tamara, go }: ViewProps) {
    const { state, active, editRazbor, closeRazbor } = shtab;
    // Минусы, которые эта стратегия берётся закрыть. По умолчанию отмечен тот,
    // с которого разбор начался: он и есть повод, остальное владелец добавляет.
    const [checked, setChecked] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) return;
        setChecked(active.closes_minus_ids.length > 0 ? active.closes_minus_ids : active.minus_id ? [active.minus_id] : []);
    }, [active]);

    if (!state || !active) return null;

    const openMinuses = state.minuses.filter((m) => m.area_code === active.area_code && (!m.done || checked.includes(m.id)));
    const closed = active.status === 'done';

    const toggle = (id: number) =>
        setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const accept = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const n = await closeRazbor(checked);
            tamara.say(
                n > 0
                    ? `Разбор закрыт, вместе с ним закрылось минусов: ${n}. Приоритетная область пересчиталась — посмотри, не сменилась ли.`
                    : 'Разбор закрыт. Ни одного минуса ты им не закрыл — если стратегия ничего не закрывает, стоит вернуться к «почему».',
                'Связка «минус — разбор» остаётся в архиве: через год по ней видно, какие причины ты угадывал, а какие нет.',
                n > 0 ? 'approve' : 'object',
            );
            go('arch');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Способ достижения краткосрочной цели</div>
                <h1>Стратегия</h1>
                <p>
                    Черновик собирается из карточек в порядке очереди. Дальше ты переписываешь его повествованием — так,
                    чтобы исполнитель прочитал один раз и не пришёл с вопросами.
                </p>
            </div>

            <div className="card">
                <div className="field" style={{ marginBottom: 0 }}>
                    <textarea
                        value={active.strategy}
                        onChange={(e) => editRazbor({ strategy: e.target.value })}
                        style={{ minHeight: 300 }}
                        placeholder="Собери черновик на карте ресурсов или напиши сам"
                    />
                </div>
                <div className="row" style={{ marginTop: 13 }}>
                    <button
                        className="btn"
                        disabled={active.resources.length === 0}
                        onClick={() => {
                            editRazbor({
                                strategy: buildStrategyDraft(active.resources, active.goal_fix, active.goal_grow),
                            });
                            tamara.say(STRATEGY_DRAFT_NOTE.say, STRATEGY_DRAFT_NOTE.why, 'explain');
                        }}
                    >
                        Пересобрать черновик из карточек
                    </button>
                    <button className="btn" onClick={() => go('projects')}>
                        Разложить на проекты
                    </button>
                </div>
            </div>

            <div className="block-label">
                <span className="eyebrow">Какие минусы закрывает эта стратегия</span>
            </div>
            <div className="card">
                {openMinuses.length === 0 ? (
                    <div style={{ color: 'var(--ink-3)', fontSize: 13.5 }}>
                        В области разбора нет открытых минусов.
                    </div>
                ) : (
                    <ul className="checks">
                        {openMinuses.map((m) => (
                            <li key={m.id}>
                                <input
                                    type="checkbox"
                                    checked={checked.includes(m.id)}
                                    disabled={closed}
                                    onChange={() => toggle(m.id)}
                                />
                                <span>
                                    <b>{m.text}</b>
                                    {m.id === active.minus_id ? <small>с него начался разбор</small> : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="hint">
                    Отмеченные закроются в реестре вместе с разбором, и в реестре будет видно, какой стратегией.
                </div>
                {error ? <div className="mark m-bad">{error}</div> : null}
                <div className="row" style={{ marginTop: 15 }}>
                    {closed ? (
                        <span className="status st-done">разбор закрыт</span>
                    ) : (
                        <button className="btn btn-primary" onClick={() => void accept()} disabled={busy}>
                            Принять стратегию и закрыть разбор
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}
