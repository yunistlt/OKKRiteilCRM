'use client';

import { useEffect } from 'react';
import { SOURCE_TITLES, topArea } from '@/lib/shtab/types';
import type { CheckResult } from '@/lib/shtab/checks';
import { checkGoal, checkSituation, checkWhy } from '@/lib/shtab/checks';
import type { ViewProps } from '../nav';

function Mark({ result }: { result: CheckResult | null }) {
    if (!result) return null;
    return <div className={`mark m-${result.kind}`}>{result.short}</div>;
}

export default function Razbor({ shtab, tamara, go }: ViewProps) {
    const { state, active, editRazbor, newRazbor } = shtab;

    const situationCheck = active ? checkSituation(active.situation) : null;
    const whyCheck = active ? checkWhy(active.why) : null;
    const goalCheck = active ? checkGoal(active.goal_fix, active.goal_grow) : null;

    // Реплики — из эффекта, а не из рендера: reactive меняет состояние Тамары,
    // и вызов прямо в теле компонента был бы записью во время отрисовки.
    useEffect(() => {
        tamara.reactive('sit', situationCheck);
    }, [tamara, situationCheck]);
    useEffect(() => {
        tamara.reactive('why', whyCheck);
    }, [tamara, whyCheck]);
    useEffect(() => {
        tamara.reactive('goal', goalCheck);
    }, [tamara, goalCheck]);

    if (!state) return null;
    if (!active) {
        const top = topArea(state.areas, state.minuses);
        return (
            <>
                <div className="view-head">
                    <h1>Разбор</h1>
                </div>
                <div className="empty">
                    Разборов ещё нет.
                    <br />
                    <br />
                    <button
                        className="btn btn-primary"
                        onClick={() => void newRazbor(top.area?.code ?? state.areas[0].code)}
                    >
                        Начать разбор приоритетной области
                    </button>
                </div>
            </>
        );
    }

    const openMinuses = state.minuses.filter((m) => m.area_code === active.area_code && !m.done);
    const picked = openMinuses.find((m) => m.id === active.minus_id) ?? null;

    const s1 = Boolean(active.situation.trim());
    const s2 = Boolean(active.why.trim());
    const s3 = active.check_inside === true && active.check_res === true && active.check_relief === true;
    const s4 = Boolean(active.goal_fix.trim() && active.goal_grow.trim());

    const created = new Date(active.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    const top = topArea(state.areas, state.minuses);

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Разбор от {created}</div>
                <h1>Разбор</h1>
                <p>
                    Здесь ты пишешь анализ, а Тамара проверяет его по методичке. Перескочить нельзя: пока шаг не
                    закрыт, следующий не откроется.
                </p>
            </div>

            <div className="row" style={{ marginBottom: 16 }}>
                <span className="eyebrow">Область разбора</span>
                <select
                    value={active.area_code}
                    onChange={(e) => editRazbor({ area_code: e.target.value, minus_id: null })}
                    style={{ width: 'auto', minWidth: 240 }}
                >
                    {state.areas.map((a) => (
                        <option key={a.code} value={a.code}>
                            {a.title}
                        </option>
                    ))}
                </select>
                <button
                    className="btn btn-sm"
                    onClick={() => void newRazbor(top.area?.code ?? active.area_code)}
                >
                    Начать новый разбор
                </button>
            </div>

            <div className="steps">
                <div className="step">
                    <div className="step-hd">
                        <span className="step-no">ШАГ 01</span>
                        <h3>Ситуация</h3>
                        <span className={`step-state ${s1 ? 'ok' : ''}`}>{s1 ? 'заполнено' : 'пусто'}</span>
                    </div>
                    <div className="step-body">
                        <div className="field">
                            <label className="fl eyebrow">Самый жирный минус области</label>
                            <select
                                value={active.minus_id ?? ''}
                                onChange={(e) => editRazbor({ minus_id: e.target.value ? Number(e.target.value) : null })}
                            >
                                <option value="">— выбери самый жирный минус области —</option>
                                {openMinuses.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.text}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {picked ? (
                            <div className="picked">
                                <b>{picked.text}</b>
                                <br />
                                <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
                                    источник: {SOURCE_TITLES[picked.source]}
                                </span>
                            </div>
                        ) : null}
                        <div className="field" style={{ marginBottom: 0 }}>
                            <label className="fl eyebrow">Разверни его в ситуацию</label>
                            <textarea
                                value={active.situation}
                                onChange={(e) => editRazbor({ situation: e.target.value })}
                                placeholder="Что происходит, к чему это ведёт и кому от этого дискомфорт"
                            />
                            <div className="hint">Ситуация шире минуса: она объясняет ущерб.</div>
                            <Mark result={situationCheck} />
                        </div>
                    </div>
                </div>

                <div className={`step ${s1 ? '' : 'locked'}`}>
                    <div className="step-hd">
                        <span className="step-no">ШАГ 02</span>
                        <h3>Почему?</h3>
                        <span className={`step-state ${s2 ? 'ok' : ''}`}>
                            {s1 ? (s2 ? 'заполнено' : 'пусто') : 'закрыт до ситуации'}
                        </span>
                    </div>
                    <div className="step-body">
                        <div className="field" style={{ marginBottom: 0 }}>
                            <label className="fl eyebrow">Почему эта ситуация возникла</label>
                            <textarea
                                value={active.why}
                                onChange={(e) => editRazbor({ why: e.target.value })}
                                placeholder="Что внутри компании это допускает — чего нет, чего не делается"
                            />
                            <div className="hint">
                                Попробуй написать «поставщики» или «кризис» — Тамара это не пропустит.
                            </div>
                            <Mark result={whyCheck} />
                        </div>
                    </div>
                </div>

                <div className={`step ${s2 ? '' : 'locked'}`}>
                    <div className="step-hd">
                        <span className="step-no">ШАГ 03</span>
                        <h3>Проверка причины</h3>
                        <span className={`step-state ${s3 ? 'ok' : ''}`}>{s3 ? 'пройдена' : '3 критерия'}</span>
                    </div>
                    <div className="step-body">
                        <ul className="checks">
                            <li>
                                <input
                                    type="checkbox"
                                    checked={active.check_inside === true}
                                    onChange={(e) => editRazbor({ check_inside: e.target.checked })}
                                />
                                <span>
                                    <b>Причина внутри организации</b>
                                    <small>Не погода, не поставщики, не кризис — то, чем ты можешь распорядиться.</small>
                                </span>
                            </li>
                            <li>
                                <input
                                    type="checkbox"
                                    checked={active.check_res === true}
                                    onChange={(e) => editRazbor({ check_res: e.target.checked })}
                                />
                                <span>
                                    <b>Устранима имеющимися ресурсами</b>
                                    <small>
                                        Если улаживание требует того, чего компания не потянет, причина найдена неверно.
                                    </small>
                                </span>
                            </li>
                            <li>
                                <input
                                    type="checkbox"
                                    checked={active.check_relief === true}
                                    onChange={(e) => editRazbor({ check_relief: e.target.checked })}
                                />
                                <span>
                                    <b>Даёт облегчение</b>
                                    <small>Внутреннее «теперь-то я точно решу». Если его нет — копай дальше.</small>
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className={`step ${s3 ? '' : 'locked'}`}>
                    <div className="step-hd">
                        <span className="step-no">ШАГ 04</span>
                        <h3>Краткосрочная цель</h3>
                        <span className={`step-state ${s4 ? 'ok' : ''}`}>
                            {s4 ? 'две части готовы' : 'нужны обе части'}
                        </span>
                    </div>
                    <div className="step-body">
                        <div className="field">
                            <label className="fl eyebrow">Часть 1 · улаживание ситуации</label>
                            <textarea
                                value={active.goal_fix}
                                onChange={(e) => editRazbor({ goal_fix: e.target.value })}
                                placeholder="К какому положению дел надо прийти, чтобы найденная ситуация исчезла"
                            />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                            <label className="fl eyebrow">Часть 2 · кусок цели компании</label>
                            <textarea
                                value={active.goal_grow}
                                onChange={(e) => editRazbor({ goal_grow: e.target.value })}
                                placeholder="Что из долгосрочной цели ты готов воплотить прямо сейчас"
                            />
                            <div className="hint">Срок в цель не ставится. Ставится желаемое положение дел.</div>
                            <Mark result={goalCheck} />
                        </div>
                        {s4 ? (
                            <div className="row" style={{ marginTop: 15 }}>
                                <button className="btn btn-primary" onClick={() => go('karta')}>
                                    Перейти к карте ресурсов
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </>
    );
}
