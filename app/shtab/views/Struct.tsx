'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../nav';

// Структура компании: блок-схема постов на свободном холсте.
//
// Блок — это пост из «Целей и постов», а не отдельная сущность: у поста уже
// есть образцовое положение дел, статистика и держатель. Здесь к нему
// добавляется место в подчинении, координаты и папка документов.
//
// Раскладка ручная и не поправляется автоматикой: схему, которую владелец
// разложил сам, он читает быстрее любой правильной авто-раскладки.

type Post = {
    id: number;
    title: string;
    area_code: string | null;
    ideal_scene: string;
    statistic: string;
    holder_name: string;
    external_uid: string | null;
    parent_id: number | null;
    pos_x: number;
    pos_y: number;
    vkp: string;
    duties: string;
};

type Doc = {
    id: number;
    post_id: number;
    title: string;
    file_name: string;
    size_bytes: number;
    has_text: boolean;
    created_at: string;
};

type Person = { id: string; fio: string; position: string; department: string; workshop: string };

const BLOCK_W = 230;
const BLOCK_H = 96;

/** Новый блок ставится в свободное место, а не поверх первого попавшегося. */
function freeSpot(posts: Post[]): { x: number; y: number } {
    if (posts.length === 0) return { x: 40, y: 40 };
    const maxY = Math.max(...posts.map((p) => p.pos_y));
    const row = posts.filter((p) => p.pos_y === maxY);
    const maxX = Math.max(...row.map((p) => p.pos_x));
    return maxX + BLOCK_W + 40 > 1200 ? { x: 40, y: maxY + BLOCK_H + 60 } : { x: maxX + BLOCK_W + 40, y: maxY };
}

function kb(bytes: number): string {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ru-RU')} КБ`;
}

export default function Struct({ shtab }: ViewProps) {
    const [posts, setPosts] = useState<Post[]>([]);
    const [docs, setDocs] = useState<Doc[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [peopleNote, setPeopleNote] = useState<string | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [zoom, setZoom] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        const res = await fetch('/api/shtab/structure');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Структура не открылась');
        setPosts(data.posts ?? []);
        setDocs(data.docs ?? []);
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                await load();
                const res = await fetch('/api/shtab/people');
                const data = await res.json();
                if (!alive) return;
                setPeople(data.people ?? []);
                // Нет связи с ЦехУспехом — это не поломка: фамилию можно
                // вписать руками. Но сказать об этом надо, иначе пустой список
                // выглядит как «в компании никого нет».
                setPeopleNote(data.available ? null : data.reason || 'ЦехУспех недоступен');
            } catch (e) {
                if (alive) setError((e as Error).message);
            }
        })();
        return () => {
            alive = false;
        };
    }, [load]);

    const post = useMemo(() => posts.find((p) => p.id === selected) ?? null, [posts, selected]);
    const postDocs = useMemo(() => docs.filter((d) => d.post_id === selected), [docs, selected]);

    const patch = useCallback(async (id: number, fields: Partial<Post>) => {
        setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
        const res = await fetch(`/api/shtab/post/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error || 'Не сохранилось');
            await load();
            return false;
        }
        setError(null);
        return true;
    }, [load]);

    // ── перетаскивание ────────────────────────────────────────────────────────
    const onPointerDown = useCallback(
        (e: React.PointerEvent, p: Post) => {
            if ((e.target as HTMLElement).closest('button')) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { id: p.id, dx: e.clientX / zoom - p.pos_x, dy: e.clientY / zoom - p.pos_y };
            setSelected(p.id);
        },
        [zoom],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            const d = drag.current;
            if (!d) return;
            const x = Math.round(e.clientX / zoom - d.dx);
            const y = Math.round(e.clientY / zoom - d.dy);
            setPosts((prev) => prev.map((p) => (p.id === d.id ? { ...p, pos_x: Math.max(0, x), pos_y: Math.max(0, y) } : p)));
        },
        [zoom],
    );

    const onPointerUp = useCallback(async () => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const moved = posts.find((p) => p.id === d.id);
        if (!moved) return;
        // Координаты уезжают одной операцией: обрыв посередине оставил бы схему
        // наполовину переехавшей.
        await fetch('/api/shtab/structure', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout: [{ id: moved.id, x: moved.pos_x, y: moved.pos_y }] }),
        });
    }, [posts]);

    // ── операции ──────────────────────────────────────────────────────────────
    const addPost = useCallback(async () => {
        const title = window.prompt('Название поста');
        if (!title?.trim()) return;
        const res = await fetch('/api/shtab/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim() }),
        });
        const data = await res.json();
        if (!res.ok) return setError(data?.error || 'Пост не завёлся');
        const spot = freeSpot(posts);
        await patch(data.id, { pos_x: spot.x, pos_y: spot.y });
        await load();
        setSelected(data.id);
    }, [posts, patch, load]);

    const removePost = useCallback(
        async (id: number) => {
            if (!window.confirm('Убрать пост вместе с его документами?')) return;
            const res = await fetch(`/api/shtab/post/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                return setError(data?.error || 'Не убрался');
            }
            setSelected(null);
            await load();
        },
        [load],
    );

    const upload = useCallback(
        async (file: File) => {
            if (!post) return;
            setBusy(true);
            setError(null);
            try {
                const body = new FormData();
                body.append('file', file);
                body.append('title', file.name);
                const res = await fetch(`/api/shtab/post/${post.id}/docs`, { method: 'POST', body });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'Файл не загрузился');
                await load();
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setBusy(false);
                if (fileRef.current) fileRef.current.value = '';
            }
        },
        [post, load],
    );

    const openDoc = useCallback(async (id: number) => {
        const res = await fetch(`/api/shtab/doc/${id}`);
        const data = await res.json();
        if (data?.url) window.open(data.url, '_blank', 'noopener');
        else setError(data?.error || 'Ссылка не получилась');
    }, []);

    const removeDoc = useCallback(
        async (id: number) => {
            if (!window.confirm('Удалить документ?')) return;
            await fetch(`/api/shtab/doc/${id}`, { method: 'DELETE' });
            await load();
        },
        [load],
    );

    const areas = shtab.state?.areas ?? [];

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Структура</div>
                <h1>Структура компании</h1>
                <p>
                    Схема постов: кто кому подчинён, что пост обязан выдавать и что лежит в его папке. Блоки таскаются
                    мышью, связь задаётся полем «подчинён». Тамара эту схему видит и документы читает.
                </p>
            </div>

            {error ? (
                <div className="card" style={{ borderColor: 'var(--signal)', marginBottom: 12 }}>
                    <span className="eyebrow" style={{ color: 'var(--signal)' }}>не вышло</span>
                    <p style={{ marginTop: 6 }}>{error}</p>
                </div>
            ) : null}

            <div className="row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => void addPost()}>
                        новый пост
                    </button>
                    <span className="eyebrow">постов: {posts.length}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>
                        −
                    </button>
                    <span className="eyebrow num">{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}>
                        +
                    </button>
                </div>
            </div>

            <div className="struct">
                <div className="struct-canvas" onPointerMove={onPointerMove} onPointerUp={() => void onPointerUp()}>
                    <div className="struct-plane" style={{ transform: `scale(${zoom})` }}>
                        <svg className="struct-links">
                            {posts
                                .filter((p) => p.parent_id)
                                .map((p) => {
                                    const parent = posts.find((x) => x.id === p.parent_id);
                                    if (!parent) return null;
                                    const x1 = parent.pos_x + BLOCK_W / 2;
                                    const y1 = parent.pos_y + BLOCK_H;
                                    const x2 = p.pos_x + BLOCK_W / 2;
                                    const y2 = p.pos_y;
                                    const mid = (y1 + y2) / 2;
                                    return (
                                        <path
                                            key={p.id}
                                            d={`M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`}
                                            fill="none"
                                        />
                                    );
                                })}
                        </svg>
                        {posts.map((p) => (
                            <div
                                key={p.id}
                                className={`struct-block${selected === p.id ? ' on' : ''}`}
                                style={{ left: p.pos_x, top: p.pos_y, width: BLOCK_W, minHeight: BLOCK_H }}
                                onPointerDown={(e) => onPointerDown(e, p)}
                            >
                                <div className="struct-title">{p.title}</div>
                                <div className="struct-holder">{p.holder_name || 'вакансия'}</div>
                                {p.vkp ? <div className="struct-vkp">{p.vkp}</div> : null}
                                <div className="struct-marks">
                                    {docs.filter((d) => d.post_id === p.id).length ? (
                                        <span className="eyebrow">док. {docs.filter((d) => d.post_id === p.id).length}</span>
                                    ) : null}
                                    {p.statistic ? <span className="eyebrow">стат.</span> : null}
                                </div>
                            </div>
                        ))}
                        {posts.length === 0 ? <p className="hint" style={{ padding: 20 }}>Постов пока нет. Заведи первый.</p> : null}
                    </div>
                </div>

                <aside className="struct-side">
                    {!post ? (
                        <p className="hint">Выбери блок, чтобы править пост и его папку.</p>
                    ) : (
                        <>
                            <div className="field">
                                <label className="fl eyebrow">Название поста</label>
                                <input
                                    type="text"
                                    defaultValue={post.title}
                                    key={`t-${post.id}`}
                                    onBlur={(e) => void patch(post.id, { title: e.target.value.trim() || post.title })}
                                />
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Подчинён</label>
                                <select
                                    value={post.parent_id ?? ''}
                                    onChange={(e) => void patch(post.id, { parent_id: e.target.value ? Number(e.target.value) : null })}
                                >
                                    <option value="">никому — верхний уровень</option>
                                    {posts
                                        .filter((p) => p.id !== post.id)
                                        .map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.title}
                                            </option>
                                        ))}
                                </select>
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Кто держит пост</label>
                                <select
                                    value={post.external_uid ?? ''}
                                    onChange={(e) => {
                                        const person = people.find((x) => x.id === e.target.value);
                                        void patch(post.id, {
                                            external_uid: person ? person.id : null,
                                            holder_name: person ? person.fio : '',
                                        });
                                    }}
                                >
                                    <option value="">вакансия</option>
                                    {people.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.fio}
                                            {p.position ? ` · ${p.position}` : ''}
                                        </option>
                                    ))}
                                </select>
                                <p className="hint">
                                    {peopleNote
                                        ? `Список из ЦехУспеха не пришёл: ${peopleNote}. Держателя можно не ставить.`
                                        : 'Люди — из ЦехУспеха, только работающие. Уволенных в списке нет.'}
                                </p>
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Область</label>
                                <select
                                    value={post.area_code ?? ''}
                                    onChange={(e) => void patch(post.id, { area_code: e.target.value || null })}
                                >
                                    <option value="">без области</option>
                                    {areas.map((a) => (
                                        <option key={a.code} value={a.code}>
                                            {a.title}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">ЦКП — что пост выдаёт наружу</label>
                                <textarea
                                    key={`v-${post.id}`}
                                    defaultValue={post.vkp}
                                    onBlur={(e) => void patch(post.id, { vkp: e.target.value })}
                                />
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Обязанности</label>
                                <textarea
                                    key={`d-${post.id}`}
                                    defaultValue={post.duties}
                                    onBlur={(e) => void patch(post.id, { duties: e.target.value })}
                                />
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Еженедельная статистика</label>
                                <input
                                    type="text"
                                    key={`s-${post.id}`}
                                    defaultValue={post.statistic}
                                    onBlur={(e) => void patch(post.id, { statistic: e.target.value })}
                                />
                            </div>

                            <div className="block-label">
                                <span className="eyebrow">Папка поста · {postDocs.length}</span>
                            </div>
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.txt,.xlsx,.xls"
                                disabled={busy}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void upload(f);
                                }}
                            />
                            <p className="hint">PDF, docx, txt, xlsx — до 4 МБ. Текст вынимается сразу, чтобы Тамара могла его прочитать.</p>
                            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                                {postDocs.map((d) => (
                                    <div className="struct-doc" key={d.id}>
                                        <button className="struct-doc-name" onClick={() => void openDoc(d.id)}>
                                            {d.title}
                                        </button>
                                        <span className="eyebrow">{kb(d.size_bytes)}</span>
                                        {d.has_text ? null : <span className="eyebrow" style={{ color: 'var(--signal)' }}>без текста</span>}
                                        <button className="btn btn-sm btn-danger" onClick={() => void removeDoc(d.id)}>
                                            убрать
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="row" style={{ marginTop: 18 }}>
                                <button className="btn btn-danger" onClick={() => void removePost(post.id)}>
                                    убрать пост
                                </button>
                            </div>
                        </>
                    )}
                </aside>
            </div>
        </>
    );
}
