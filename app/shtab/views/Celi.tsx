'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GoalKind } from '@/lib/shtab/types';
import { checkPostStatistic } from '@/lib/shtab/checks';
import type { ViewProps } from '../nav';

const SAVE_DELAY_MS = 700;

export default function Celi({ shtab, tamara }: ViewProps) {
    const { state, saveGoals, addPost, patchPost, removePost } = shtab;
    const [newPost, setNewPost] = useState('');
    const [postBusy, setPostBusy] = useState(false);
    const [draft, setDraft] = useState<Record<GoalKind, string> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (state && !draft) setDraft({ ...state.goals });
    }, [state, draft]);

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );

    // Худший из постов задаёт реплику: пока есть пост без статистики,
    // говорить про дорогие в подсчёте незачем.
    const worstPost = useMemo(() => {
        let result: ReturnType<typeof checkPostStatistic> = null;
        for (const post of state?.posts ?? []) {
            const v = checkPostStatistic(post.statistic);
            if (v?.kind === 'bad') return v;
            if (v && !result) result = v;
        }
        return result;
    }, [state?.posts]);

    useEffect(() => {
        tamara.reactive('post', worstPost);
    }, [tamara, worstPost]);

    if (!state || !draft) return null;

    const createPost = async () => {
        const title = newPost.trim();
        if (!title || postBusy) return;
        setPostBusy(true);
        try {
            await addPost(title, null);
            setNewPost('');
        } finally {
            setPostBusy(false);
        }
    };

    const edit = (kind: GoalKind, value: string) => {
        setDraft((prev) => (prev ? { ...prev, [kind]: value } : prev));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveGoals({ [kind]: value }), SAVE_DELAY_MS);
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Два документа, не один</div>
                <h1>Цели и посты</h1>
                <p>
                    Цель компании и цель владельца разделены: сотрудник не сделает своей целью твою прибыль и твою
                    свободу. Позитивная часть краткосрочной цели берётся только из левого документа.
                </p>
            </div>

            <div className="docs">
                <div className="doc">
                    <div className="eyebrow">Долгосрочная · архитектурная</div>
                    <h3>Цель компании</h3>
                    <div className="doc-meta">видна команде</div>
                    <textarea
                        value={draft.company}
                        onChange={(e) => edit('company', e.target.value)}
                        style={{ minHeight: 230 }}
                        placeholder="Куда идёт компания и каким станет положение дел, когда она туда придёт"
                    />
                </div>
                <div className="doc private">
                    <div className="eyebrow">
                        <span className="lock">приватно</span> · только владелец
                    </div>
                    <h3>Цель владельца</h3>
                    <div className="doc-meta">не показывается команде</div>
                    <textarea
                        value={draft.owner}
                        onChange={(e) => edit('owner', e.target.value)}
                        style={{ minHeight: 230 }}
                        placeholder="Чего хочешь ты сам — то, что не годится ставить целью сотруднику"
                    />
                </div>
            </div>

            <div className="block-label">
                <span className="eyebrow">Ценный конечный продукт компании</span>
            </div>
            <div className="card">
                <textarea
                    value={draft.product}
                    onChange={(e) => edit('product', e.target.value)}
                    style={{ minHeight: 88 }}
                    placeholder="Что компания отдаёт наружу в законченном виде, за что ей платят"
                />
            </div>

            <div className="block-label">
                <span className="eyebrow">Посты · образцовое положение и статистики</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '72ch', marginBottom: 12 }}>
                Пост — не сотрудник. У поста своё образцовое положение дел и своя еженедельная статистика; один
                человек может занимать несколько постов, а пост может стоять вакантным.
            </p>

            <div className="card" style={{ marginBottom: 16 }}>
                <div className="row">
                    <input
                        type="text"
                        value={newPost}
                        onChange={(e) => setNewPost(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void createPost()}
                        placeholder="Название поста. Например: начальник цеха по качеству и ТПП"
                        style={{ flex: 1, minWidth: 260 }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={() => void createPost()}
                        disabled={postBusy || !newPost.trim()}
                    >
                        Завести пост
                    </button>
                </div>
            </div>

            {state.posts.length === 0 ? (
                <div className="empty">
                    Постов нет. Пока их нет, разговор о работе остаётся разговором о людях, а не о том, что каждый
                    из них должен производить.
                </div>
            ) : (
                <div className="tablewrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Пост</th>
                                <th>Образцовое положение дел</th>
                                <th>Статистика</th>
                                <th>Занимает и кто он в ЦехУспехе</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {state.posts.map((post) => {
                                const v = checkPostStatistic(post.statistic);
                                return (
                                    <tr key={post.id}>
                                        <td>
                                            <input
                                                type="text"
                                                value={post.title}
                                                onChange={(e) => patchPost(post.id, { title: e.target.value })}
                                                style={{ fontWeight: 600 }}
                                            />
                                            <select
                                                value={post.area_code ?? ''}
                                                onChange={(e) =>
                                                    patchPost(post.id, { area_code: e.target.value || null })
                                                }
                                                style={{ marginTop: 6 }}
                                            >
                                                <option value="">— без области —</option>
                                                {state.areas.map((a) => (
                                                    <option key={a.code} value={a.code}>
                                                        {a.title}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td>
                                            <textarea
                                                value={post.ideal_scene}
                                                onChange={(e) => patchPost(post.id, { ideal_scene: e.target.value })}
                                                placeholder="Что должно быть, когда пост работает как надо"
                                                style={{ minHeight: 64 }}
                                            />
                                        </td>
                                        <td>
                                            <textarea
                                                value={post.statistic}
                                                onChange={(e) => patchPost(post.id, { statistic: e.target.value })}
                                                placeholder="Что считаем каждую неделю"
                                                style={{ minHeight: 64 }}
                                            />
                                            {v ? <div className={`mark m-${v.kind}`}>{v.short}</div> : null}
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                value={post.holder_name}
                                                onChange={(e) => patchPost(post.id, { holder_name: e.target.value })}
                                                placeholder="вакантен"
                                            />
                                            {/* По этому идентификатору консультант ЦехУспеха узнаёт вошедшего
                                                и находит задачи его поста. Пусто — помогать будет нечему. */}
                                            <input
                                                type="text"
                                                className="uid"
                                                value={post.external_uid ?? ''}
                                                onChange={(e) =>
                                                    patchPost(post.id, { external_uid: e.target.value.trim() || null })
                                                }
                                                placeholder="кто он в ЦехУспехе"
                                                title="Идентификатор занимающего пост в ЦехУспехе: по нему тамошний консультант находит его задачи"
                                            />
                                        </td>
                                        <td>
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() => void removePost(post.id)}
                                            >
                                                убрать
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
