'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POST_COLORS, type PostColor } from '@/lib/shtab/structure';
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
    color: PostColor | null;
    level_override: number | null;
    collapsed: boolean;
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

const COLOR_TITLES: Record<PostColor, string> = {
    blue: 'синий',
    green: 'зелёный',
    clay: 'терракота',
    sand: 'песочный',
    grey: 'серый',
    white: 'белый',
};

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
    /** Смещение бесконечного холста: лист едет под схемой, как в Miro. */
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    /** Масштаб подбирается один раз: дальше его крутит человек, и перебивать его нельзя. */
    const fitted = useRef(false);
    const zoomRef = useRef(1);
    /** Протяжка холста за пустое место — как в майнд-картах. */
    const pan = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
    const offsetRef = useRef({ x: 0, y: 0 });
    /** Тянем связь от поста: от кого ведём и куда указывает курсор. */
    const [linking, setLinking] = useState<{ from: number; x: number; y: number; over: number | null } | null>(null);
    const linkRef = useRef<typeof linking>(null);
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

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        offsetRef.current = offset;
    }, [offset]);

    const post = useMemo(() => posts.find((p) => p.id === selected) ?? null, [posts, selected]);
    const postDocs = useMemo(() => docs.filter((d) => d.post_id === selected), [docs, selected]);

    /** Свёрнутая ветка: сам пост виден, его подчинённые — нет. */
    const visible = useMemo(() => {
        const byId = new Map(posts.map((p) => [p.id, p]));
        const hidden = (p: Post) => {
            const seen = new Set<number>([p.id]);
            let cur = p;
            while (cur.parent_id) {
                const up = byId.get(cur.parent_id);
                if (!up || seen.has(up.id)) return false;
                if (up.collapsed) return true;
                seen.add(up.id);
                cur = up;
            }
            return false;
        };
        return posts.filter((p) => !hidden(p));
    }, [posts]);

    const kidCount = useMemo(() => {
        const m = new Map<number, number>();
        for (const p of posts) if (p.parent_id) m.set(p.parent_id, (m.get(p.parent_id) ?? 0) + 1);
        return m;
    }, [posts]);

    // Границы содержимого. Холст бесконечен во все стороны, поэтому координаты
    // постов могут быть и отрицательными: рисуем всё относительно левого
    // верхнего угла дерева, а не относительно нуля.
    const bounds = useMemo(() => {
        const src = visible.length ? visible : posts;
        if (src.length === 0) return { minX: 0, minY: 0, w: BLOCK_W, h: BLOCK_H };
        const minX = Math.min(...src.map((p) => p.pos_x));
        const minY = Math.min(...src.map((p) => p.pos_y));
        const maxX = Math.max(...src.map((p) => p.pos_x)) + BLOCK_W;
        const maxY = Math.max(...src.map((p) => p.pos_y)) + BLOCK_H;
        return { minX, minY, w: maxX - minX, h: maxY - minY };
    }, [posts, visible]);

    /** Уровень поста в дереве: по нему красится блок, как в майнд-картах. */
    const levelOf = useMemo(() => {
        const byId = new Map(posts.map((p) => [p.id, p]));
        const out = new Map<number, number>();
        for (const p of posts) {
            let depth = 0;
            let cur = p;
            const seen = new Set<number>([p.id]);
            while (cur.parent_id) {
                const up = byId.get(cur.parent_id);
                if (!up || seen.has(up.id)) break; // кольцо в данных схему не вешает
                seen.add(up.id);
                cur = up;
                depth += 1;
            }
            out.set(p.id, Math.min(depth, 3));
        }
        return out;
    }, [posts]);

    /** Показать схему по центру листа. */
    const fitView = useCallback(() => {
        const box = canvasRef.current;
        if (!box || box.clientWidth === 0 || posts.length === 0) return;
        const pad = 48;
        const byWidth = (box.clientWidth - pad * 2) / bounds.w;
        const byHeight = (box.clientHeight - pad * 2) / bounds.h;
        // Вмещаем целиком, как «fit to screen» в Miro: подчинённые стоят в ряд,
        // схема шире экрана, и разглядывать её приближают жестами.
        const z = Math.min(1.3, Math.max(0.25, +Math.min(byWidth, byHeight).toFixed(2)));
        setZoom(z);
        setOffset({
            x: (box.clientWidth - bounds.w * z) / 2,
            y: (box.clientHeight - bounds.h * z) / 2,
        });
    }, [bounds, posts.length]);

    // При первом открытии схема стоит по центру листа целиком: иначе человек
    // видит угол и решает, что постов всего пять.
    useEffect(() => {
        if (fitted.current || posts.length === 0) return;
        if (!canvasRef.current || canvasRef.current.clientWidth === 0) return;
        fitted.current = true;
        fitView();
    }, [posts.length, fitView]);

    // Окно меняет ширину (свернули меню, потянули панель) — схема должна остаться
    // там же относительно центра, а не уехать за край.
    useEffect(() => {
        const box = canvasRef.current;
        if (!box || typeof ResizeObserver === 'undefined') return;
        let prev = { w: box.clientWidth, h: box.clientHeight };
        const ro = new ResizeObserver(() => {
            const w = box.clientWidth;
            const h = box.clientHeight;
            if (w === 0 || h === 0) return;
            const dx = (w - prev.w) / 2;
            const dy = (h - prev.h) / 2;
            prev = { w, h };
            if (dx || dy) setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
        });
        ro.observe(box);
        return () => ro.disconnect();
    }, []);

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
            drag.current = { id: p.id, dx: e.clientX - p.pos_x * zoom, dy: e.clientY - p.pos_y * zoom };
            canvasRef.current?.classList.add('dragging');
            setSelected(p.id);
        },
        [zoom],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            const link = linkRef.current;
            if (link) {
                // Под курсором ищем блок-цель: подсвечиваем его, пока тянем.
                const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                const overId = el?.closest('.struct-block')?.getAttribute('data-id');
                const over = overId ? Number(overId) : null;
                const next = { ...link, x: e.clientX, y: e.clientY, over: over === link.from ? null : over };
                linkRef.current = next;
                setLinking(next);
                return;
            }
            const p = pan.current;
            if (p) {
                if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 4) p.moved = true;
                setOffset({ x: p.ox + (e.clientX - p.x), y: p.oy + (e.clientY - p.y) });
                return;
            }
            const d = drag.current;
            if (!d) return;
            // Холст бесконечен: отрицательные координаты законны, блок тащится куда угодно.
            const x = Math.round((e.clientX - d.dx) / zoom);
            const y = Math.round((e.clientY - d.dy) / zoom);
            setPosts((prev) => prev.map((p) => (p.id === d.id ? { ...p, pos_x: x, pos_y: y } : p)));
        },
        [zoom],
    );

    const onPointerUp = useCallback(async () => {
        const link = linkRef.current;
        if (link) {
            linkRef.current = null;
            setLinking(null);
            if (link.over && link.over !== link.from) {
                // Цикл ловит сервер: он один знает всё дерево целиком.
                await patch(link.from, { parent_id: link.over });
            }
            return;
        }
        if (pan.current) {
            // Клик мимо блоков (без протяжки) закрывает карточку поста:
            // открытая форма от предыдущего клика мешала смотреть схему.
            if (!pan.current.moved) setSelected(null);
            pan.current = null;
            canvasRef.current?.classList.remove('panning');
        }
        const d = drag.current;
        drag.current = null;
        canvasRef.current?.classList.remove('dragging');
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

    // Трекпад.
    //
    // Щипок в Chrome приходит как колесо с ctrlKey, а в Safari — собственными
    // событиями gesture*, которых больше нигде нет. Было сделано только первое,
    // поэтому в Safari жест не работал вовсе.
    //
    // Масштабируем вокруг точки под пальцами: иначе схема уезжает в сторону и
    // кажется, что жест «срабатывает не туда».
    useEffect(() => {
        const box = canvasRef.current;
        if (!box) return;

        const zoomAt = (next: number, clientX: number, clientY: number) => {
            const rect = box.getBoundingClientRect();
            const atX = clientX - rect.left;
            const atY = clientY - rect.top;
            const z0 = zoomRef.current;
            const z = Math.min(2.5, Math.max(0.2, +next.toFixed(3)));
            const o = offsetRef.current;
            // Точка под пальцами остаётся на месте: смещение подтягивается за масштабом.
            setOffset({ x: atX - (atX - o.x) * (z / z0), y: atY - (atY - o.y) * (z / z0) });
            setZoom(z);
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                zoomAt(zoomRef.current * (1 - e.deltaY / 220), e.clientX, e.clientY);
                return;
            }
            // Два пальца по трекпаду возят лист во все стороны, как в Miro.
            const o = offsetRef.current;
            setOffset({ x: o.x - e.deltaX, y: o.y - e.deltaY });
        };

        // Safari: scale приходит накопленным от начала жеста.
        let gestureBase = 1;
        let gestureAt = { x: 0, y: 0 };
        const onGestureStart = (e: any) => {
            e.preventDefault();
            gestureBase = zoomRef.current;
            gestureAt = { x: e.clientX, y: e.clientY };
        };
        const onGestureChange = (e: any) => {
            e.preventDefault();
            zoomAt(gestureBase * e.scale, e.clientX || gestureAt.x, e.clientY || gestureAt.y);
        };
        const stop = (e: Event) => e.preventDefault();

        box.addEventListener('wheel', onWheel, { passive: false });
        box.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
        box.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
        box.addEventListener('gestureend', stop, { passive: false });
        return () => {
            box.removeEventListener('wheel', onWheel);
            box.removeEventListener('gesturestart', onGestureStart as EventListener);
            box.removeEventListener('gesturechange', onGestureChange as EventListener);
            box.removeEventListener('gestureend', stop);
        };
    }, []);


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
                    <button className="btn btn-sm" onClick={fitView} title="Показать схему целиком по центру">
                        по центру
                    </button>
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
                <div
                    ref={canvasRef}
                    className="struct-canvas"
                    onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest('.struct-block')) return;
                        const box = canvasRef.current;
                        if (!box) return;
                        pan.current = {
                            x: e.clientX,
                            y: e.clientY,
                            ox: offsetRef.current.x,
                            oy: offsetRef.current.y,
                            moved: false,
                        };
                        box.classList.add('panning');
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => void onPointerUp()}
                    onPointerLeave={() => void onPointerUp()}
                >
                    <div
                        className="struct-plane"
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                            width: bounds.w,
                            height: bounds.h,
                        }}
                    >
                        <svg className="struct-links" width={bounds.w} height={bounds.h}>
                            {visible
                                .filter((p) => p.parent_id)
                                .map((p) => {
                                    const parent = visible.find((x) => x.id === p.parent_id);
                                    if (!parent) return null;
                                    // Одна форма связи на все случаи: вниз от середины
                                    // руководителя, вбок по общей полке и вниз в середину
                                    // подчинённого. Углы скруглены — так читается спокойнее,
                                    // чем ломаная под прямым углом.
                                    const ax = parent.pos_x - bounds.minX + BLOCK_W / 2;
                                    const ay = parent.pos_y - bounds.minY + BLOCK_H;
                                    const bx = p.pos_x - bounds.minX + BLOCK_W / 2;
                                    const by = p.pos_y - bounds.minY;
                                    const shelf = by - 30 > ay ? by - 30 : (ay + by) / 2;
                                    const r = Math.min(14, Math.abs(bx - ax) / 2, Math.abs(shelf - ay), Math.abs(by - shelf));
                                    const dir = bx > ax ? 1 : -1;
                                    const d =
                                        Math.abs(bx - ax) < 2
                                            ? `M ${ax} ${ay} V ${by}`
                                            : `M ${ax} ${ay} V ${shelf - r} Q ${ax} ${shelf} ${ax + r * dir} ${shelf} ` +
                                              `H ${bx - r * dir} Q ${bx} ${shelf} ${bx} ${shelf + r} V ${by}`;
                                    return <path key={p.id} d={d} fill="none" />;
                                })}
                        </svg>
                        {visible.map((p) => (
                            <div
                                key={p.id}
                                className={`struct-block${selected === p.id ? ' on' : ''}`}
                                data-id={p.id}
                                data-level={p.level_override ?? levelOf.get(p.id) ?? 0}
                                data-color={p.color ?? undefined}
                                data-target={linking && linking.over === p.id ? 'yes' : undefined}
                                style={{
                                    left: p.pos_x - bounds.minX,
                                    top: p.pos_y - bounds.minY,
                                    width: BLOCK_W,
                                    minHeight: BLOCK_H,
                                }}
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

                                {/* Порт связи: тянем от него к другому посту, и тот становится
                                    руководителем. Раньше подчинение задавалось только списком
                                    в карточке — мышью было никак. */}
                                <button
                                    className="struct-port"
                                    style={{ transform: `translateX(-50%) scale(${(1 / zoom).toFixed(2)})` }}
                                    title="Потяни к руководителю, чтобы подчинить пост"
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        const next = { from: p.id, x: e.clientX, y: e.clientY, over: null };
                                        linkRef.current = next;
                                        setLinking(next);
                                    }}
                                >
                                    +
                                </button>

                                {kidCount.get(p.id) ? (
                                    <button
                                        className="struct-fold"
                                        style={{ transform: `translateY(-50%) scale(${(1 / zoom).toFixed(2)})` }}
                                        title={p.collapsed ? 'Развернуть ветку' : 'Свернуть ветку'}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void patch(p.id, { collapsed: !p.collapsed });
                                        }}
                                    >
                                        {p.collapsed ? `+${kidCount.get(p.id)}` : '−'}
                                    </button>
                                ) : null}
                            </div>
                        ))}
                        {posts.length === 0 ? <p className="hint" style={{ padding: 20 }}>Постов пока нет. Заведи первый.</p> : null}
                    </div>
                </div>

                <aside className={`struct-side${post ? '' : ' hidden'}`}>
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
                                <label className="fl eyebrow">Цвет блока</label>
                                <div className="struct-swatches">
                                    <button
                                        className={`struct-swatch${post.color ? '' : ' on'}`}
                                        data-color="auto"
                                        title="По уровню подчинения"
                                        onClick={() => void patch(post.id, { color: null })}
                                    >
                                        авто
                                    </button>
                                    {POST_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            className={`struct-swatch${post.color === c ? ' on' : ''}`}
                                            data-color={c}
                                            title={COLOR_TITLES[c]}
                                            onClick={() => void patch(post.id, { color: c })}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="field">
                                <label className="fl eyebrow">Уровень</label>
                                <select
                                    value={post.level_override ?? ''}
                                    onChange={(e) =>
                                        void patch(post.id, {
                                            level_override: e.target.value === '' ? null : Number(e.target.value),
                                        })
                                    }
                                >
                                    <option value="">по подчинению</option>
                                    <option value="0">первый — верх</option>
                                    <option value="1">второй</option>
                                    <option value="2">третий</option>
                                    <option value="3">четвёртый</option>
                                </select>
                                <p className="hint">
                                    Уровень задаёт плотность заливки. Цвет, выбранный вручную, важнее уровня.
                                </p>
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
                                accept=".pdf,.doc,.docx,.txt,.csv,.tsv,.xlsx,.xls"
                                disabled={busy}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void upload(f);
                                }}
                            />
                            <p className="hint">PDF, docx, txt, csv, xlsx — до 4 МБ. Текст вынимается сразу, чтобы Тамара могла его прочитать.</p>
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
