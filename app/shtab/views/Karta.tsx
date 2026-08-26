'use client';

import { useEffect, useState } from 'react';
import { checkResourceName } from '@/lib/shtab/checks';
import { STRATEGY_DRAFT_NOTE, buildStrategyDraft } from '@/lib/shtab/strategy';
import type { ShtabResource } from '@/lib/shtab/types';
import type { ViewProps } from '../nav';

export default function Karta({ shtab, tamara, go }: ViewProps) {
    const { active, editRazbor } = shtab;
    const [draft, setDraft] = useState('');
    const [haveDrafts, setHaveDrafts] = useState<Record<number, string>>({});

    const columns = active?.resources ?? [];
    const orphan = columns.find((c) => c.available.length === 0) ?? null;

    // Незакрытый ресурс — то самое место, где обычно рвётся план, поэтому
    // Тамара говорит об этом сама, а не ждёт вопроса.
    useEffect(() => {
        if (!columns.length) {
            tamara.reactive('orph', null);
            return;
        }
        tamara.reactive(
            'orph',
            orphan
                ? {
                      kind: 'bad',
                      say: `Под карточкой «${orphan.missing}» нет ни одного доступного ресурса. Это ровно то место, где рвётся план: он исходит из того, что ресурс появится сам. Найди, чем его закрыть, или убери из стратегии.`,
                      why: 'Стратегия строится только из проверенных ресурсов. День, потраченный на их изучение, экономит месяцы.',
                  }
                : {
                      kind: 'ok',
                      say: 'Каждый отсутствующий ресурс чем-то закрыт. Расставь очередь стрелками и переходи к стратегии.',
                      why: 'После анализа ресурсов расставляется последовательность, и только потом пишется стратегия.',
                  },
        );
    }, [tamara, orphan, columns.length]);

    if (!active) return null;

    if (!(active.goal_fix.trim() && active.goal_grow.trim())) {
        return (
            <>
                <div className="view-head">
                    <div className="eyebrow">Стол с карточками</div>
                    <h1>Карта ресурсов</h1>
                </div>
                <div className="empty">
                    Сначала сформулируй краткосрочную цель — карта строится под неё.
                    <br />
                    <br />
                    <button className="btn btn-primary" onClick={() => go('razbor')}>
                        К разбору
                    </button>
                </div>
            </>
        );
    }

    const write = (next: ShtabResource[]) => editRazbor({ resources: next.map((c, i) => ({ ...c, ordinal: i })) });

    const addColumn = () => {
        const name = draft.trim();
        if (!name) return;
        const verdict = checkResourceName(name);
        if (verdict) tamara.reactive(`res-${name}`, verdict);
        write([...columns, { ordinal: columns.length, missing: name, available: [] }]);
        setDraft('');
    };

    const addHave = (i: number) => {
        const name = (haveDrafts[i] ?? '').trim();
        if (!name) return;
        const verdict = checkResourceName(name);
        if (verdict) tamara.reactive(`res-${name}`, verdict);
        write(columns.map((c, j) => (j === i ? { ...c, available: [...c.available, name] } : c)));
        setHaveDrafts((prev) => ({ ...prev, [i]: '' }));
    };

    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= columns.length) return;
        const next = [...columns];
        [next[i], next[j]] = [next[j], next[i]];
        write(next);
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Стол с карточками</div>
                <h1>Карта ресурсов</h1>
                <p>
                    Розовая — ресурс, которого нет, но он нужен для цели. Голубые под ней — то, что доступно, чтобы его
                    получить. Номер сверху — очередь исполнения.
                </p>
            </div>

            <div className="picked" style={{ marginBottom: 16 }}>
                <span className="eyebrow">Цель, под которую собираем</span>
                <br />
                {active.goal_fix} <span style={{ color: 'var(--ink-3)' }}>+</span> {active.goal_grow}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>
                    Какой ресурс тебе необходимо иметь, чтобы прийти к цели?
                </div>
                <div className="row">
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                        placeholder="Например: 180 тыс. руб. на вторую камеру полимеризации"
                        style={{ flex: 1, minWidth: 250 }}
                    />
                    <button className="btn btn-primary" onClick={addColumn}>
                        Добавить розовую
                    </button>
                </div>
                <div className="hint">Пиши конкретно. Напиши просто «деньги» — Тамара отреагирует.</div>
            </div>

            {columns.length === 0 ? (
                <div className="empty">
                    Стол пуст. Задай себе вопрос из методички: «какой ресурс мне необходимо иметь, чтобы прийти к этой
                    цели?»
                </div>
            ) : (
                <>
                    <div className="table-top">
                        <div className="cols">
                            {columns.map((c, i) => (
                                <div key={i} className={`col${c.available.length ? '' : ' orphan'}`}>
                                    <div className="sticker miss">
                                        <span className="seq">{i + 1}</span>
                                        {c.missing}
                                        {c.available.length === 0 ? (
                                            <span className="orphan-flag">ресурс не закрыт</span>
                                        ) : null}
                                        <button
                                            className="x"
                                            title="убрать"
                                            onClick={() => write(columns.filter((_, j) => j !== i))}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    {c.available.map((t, j) => (
                                        <div key={j} className="sticker have">
                                            {t}
                                            <button
                                                className="x"
                                                title="убрать"
                                                onClick={() =>
                                                    write(
                                                        columns.map((col, k) =>
                                                            k === i
                                                                ? { ...col, available: col.available.filter((_, q) => q !== j) }
                                                                : col,
                                                        ),
                                                    )
                                                }
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <div className="col-add">
                                        <input
                                            type="text"
                                            value={haveDrafts[i] ?? ''}
                                            onChange={(e) => setHaveDrafts((prev) => ({ ...prev, [i]: e.target.value }))}
                                            onKeyDown={(e) => e.key === 'Enter' && addHave(i)}
                                            placeholder="доступный ресурс…"
                                        />
                                        <button className="btn btn-sm" onClick={() => addHave(i)}>
                                            +
                                        </button>
                                    </div>
                                    <div className="col-move">
                                        <button className="btn btn-sm" onClick={() => move(i, -1)}>
                                            ←
                                        </button>
                                        <button className="btn btn-sm" onClick={() => move(i, 1)}>
                                            →
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="legend">
                        <span>
                            <i className="chip miss" /> отсутствующий ресурс
                        </span>
                        <span>
                            <i className="chip have" /> доступный ресурс
                        </span>
                        <span style={{ color: 'var(--signal)' }}>обведено — не закрыт ничем</span>
                    </div>
                    <div className="row" style={{ marginTop: 18 }}>
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                editRazbor({
                                    strategy: buildStrategyDraft(columns, active.goal_fix, active.goal_grow),
                                });
                                tamara.say(STRATEGY_DRAFT_NOTE.say, STRATEGY_DRAFT_NOTE.why, 'explain');
                                go('strat');
                            }}
                        >
                            Собрать черновик стратегии
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
