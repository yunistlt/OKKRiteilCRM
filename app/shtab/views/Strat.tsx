'use client';

import { STRATEGY_DRAFT_NOTE, buildStrategyDraft } from '@/lib/shtab/strategy';
import type { ViewProps } from '../nav';

export default function Strat({ shtab, tamara, go }: ViewProps) {
    const { active, editRazbor } = shtab;
    if (!active) return null;

    const closeRazbor = () => {
        editRazbor({ status: 'done' });
        tamara.say(
            'Разбор закрыт. Он остаётся в архиве: через год отсюда будет видно, какие причины ты угадывал, а какие нет.',
            'Каждый разбор хранится целиком — ситуация, «почему», стратегия.',
            'approve',
        );
        go('arch');
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
                        style={{ minHeight: 340 }}
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
                    <button className="btn btn-primary" onClick={closeRazbor}>
                        Принять стратегию и закрыть разбор
                    </button>
                </div>
            </div>
        </>
    );
}
