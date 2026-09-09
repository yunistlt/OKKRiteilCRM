'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GoalKind, ShtabMinus, ShtabPost, ShtabProject, ShtabRazbor, ShtabState } from '@/lib/shtab/types';

// Состояние Штаба и запись в базу.
//
// Правки разбора владелец вносит в текстовые поля — писать в базу на каждую
// букву незачем, поэтому изменения ложатся в локальное состояние сразу, а
// уходят на сервер пачкой после паузы в наборе. Всё остальное (завести минус,
// закрыть минус, начать разбор) — действия разовые и уходят сразу.

const SAVE_DELAY_MS = 700;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Поля разбора, которые владелец правит текстом. */
export type RazborPatch = Partial<
    Pick<
        ShtabRazbor,
        | 'status'
        | 'minus_id'
        | 'situation'
        | 'why'
        | 'check_inside'
        | 'check_res'
        | 'check_relief'
        | 'goal_fix'
        | 'goal_grow'
        | 'strategy'
        | 'area_code'
    >
> & { resources?: ShtabRazbor['resources'] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Запрос ${url} вернул ${res.status}`);
    return body as T;
}

export function useShtab() {
    const [state, setState] = useState<ShtabState | null>(null);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

    const pending = useRef<RazborPatch>({});
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeIdRef = useRef<number | null>(null);
    activeIdRef.current = activeId;

    useEffect(() => {
        let alive = true;
        request<ShtabState>('/api/shtab/state')
            .then((data) => {
                if (!alive) return;
                setState(data);
                setActiveId(data.razbory[0]?.id ?? null);
            })
            .catch((e: Error) => alive && setLoadError(e.message));
        return () => {
            alive = false;
        };
    }, []);

    const active = useMemo(
        () => state?.razbory.find((r) => r.id === activeId) ?? state?.razbory[0] ?? null,
        [state, activeId],
    );

    const flush = useCallback(async () => {
        const id = activeIdRef.current;
        const patch = pending.current;
        pending.current = {};
        if (!id || Object.keys(patch).length === 0) return;

        setSaveStatus('saving');
        try {
            const saved = await request<ShtabRazbor>(`/api/shtab/razbor/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            });
            setState((prev) =>
                prev ? { ...prev, razbory: prev.razbory.map((r) => (r.id === id ? saved : r)) } : prev,
            );
            setSaveStatus('saved');
        } catch {
            // Локальные правки не откатываем: владелец их видит и они не потеряны,
            // следующая пауза в наборе отправит их снова.
            setSaveStatus('error');
        }
    }, []);

    /** Правка разбора: сразу на экран, в базу — после паузы. */
    const editRazbor = useCallback(
        (patch: RazborPatch) => {
            const id = activeIdRef.current;
            if (!id) return;
            setState((prev) =>
                prev ? { ...prev, razbory: prev.razbory.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev,
            );
            pending.current = { ...pending.current, ...patch };
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
        },
        [flush],
    );

    // Незаписанная правка не должна уехать вместе с вкладкой.
    useEffect(() => {
        const onHide = () => {
            if (Object.keys(pending.current).length > 0) void flush();
        };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onHide);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onHide);
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, [flush]);

    const addMinus = useCallback(async (text: string, areaCode: string) => {
        const created = await request<ShtabMinus>('/api/shtab/minus', {
            method: 'POST',
            body: JSON.stringify({ text, area_code: areaCode, source: 'owner' }),
        });
        setState((prev) => (prev ? { ...prev, minuses: [...prev.minuses, created] } : prev));
        return created;
    }, []);

    const toggleMinus = useCallback(async (minus: ShtabMinus) => {
        const saved = await request<ShtabMinus>(`/api/shtab/minus/${minus.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ done: !minus.done }),
        });
        setState((prev) =>
            prev ? { ...prev, minuses: prev.minuses.map((m) => (m.id === saved.id ? saved : m)) } : prev,
        );
    }, []);

    const newRazbor = useCallback(
        async (areaCode: string) => {
            await flush();
            const created = await request<ShtabRazbor>('/api/shtab/razbor', {
                method: 'POST',
                body: JSON.stringify({ area_code: areaCode }),
            });
            setState((prev) => (prev ? { ...prev, razbory: [created, ...prev.razbory] } : prev));
            setActiveId(created.id);
            return created;
        },
        [flush],
    );

    const openRazbor = useCallback(
        async (id: number) => {
            await flush();
            setActiveId(id);
        },
        [flush],
    );

    // ── проекты ────────────────────────────────────────────────────────────
    const patchRazborLocal = useCallback((id: number, patch: (r: ShtabRazbor) => ShtabRazbor) => {
        setState((prev) => (prev ? { ...prev, razbory: prev.razbory.map((r) => (r.id === id ? patch(r) : r)) } : prev));
    }, []);

    const addProject = useCallback(
        async (title: string) => {
            const id = activeIdRef.current;
            if (!id) return;
            const created = await request<ShtabProject>('/api/shtab/project', {
                method: 'POST',
                body: JSON.stringify({ razbor_id: id, title }),
            });
            patchRazborLocal(id, (r) => ({ ...r, projects: [...r.projects, created] }));
        },
        [patchRazborLocal],
    );

    // Правки проекта уходят той же пачкой с задержкой, что и текст разбора:
    // имя ответственного набирают по букве.
    const projectTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const patchProject = useCallback(
        (projectId: number, patch: Partial<ShtabProject>) => {
            const id = activeIdRef.current;
            if (!id) return;
            patchRazborLocal(id, (r) => ({
                ...r,
                projects: r.projects.map((p) => (p.id === projectId ? { ...p, ...patch } : p)),
            }));

            const timers = projectTimers.current;
            const prev = timers.get(projectId);
            if (prev) clearTimeout(prev);
            timers.set(
                projectId,
                setTimeout(() => {
                    timers.delete(projectId);
                    setSaveStatus('saving');
                    request<ShtabProject>(`/api/shtab/project/${projectId}`, {
                        method: 'PATCH',
                        body: JSON.stringify(patch),
                    })
                        .then(() => setSaveStatus('saved'))
                        .catch(() => setSaveStatus('error'));
                }, SAVE_DELAY_MS),
            );
        },
        [patchRazborLocal],
    );

    const removeProject = useCallback(
        async (projectId: number) => {
            const id = activeIdRef.current;
            if (!id) return;
            await request(`/api/shtab/project/${projectId}`, { method: 'DELETE' });
            patchRazborLocal(id, (r) => ({ ...r, projects: r.projects.filter((p) => p.id !== projectId) }));
        },
        [patchRazborLocal],
    );

    // ── посты ──────────────────────────────────────────────────────────────
    const addPost = useCallback(async (title: string, areaCode: string | null) => {
        const created = await request<ShtabPost>('/api/shtab/post', {
            method: 'POST',
            body: JSON.stringify({ title, area_code: areaCode }),
        });
        setState((prev) => (prev ? { ...prev, posts: [...prev.posts, created] } : prev));
    }, []);

    const postTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const patchPost = useCallback((postId: number, patch: Partial<ShtabPost>) => {
        setState((prev) =>
            prev ? { ...prev, posts: prev.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)) } : prev,
        );
        const timers = postTimers.current;
        const prev = timers.get(postId);
        if (prev) clearTimeout(prev);
        timers.set(
            postId,
            setTimeout(() => {
                timers.delete(postId);
                setSaveStatus('saving');
                request<ShtabPost>(`/api/shtab/post/${postId}`, { method: 'PATCH', body: JSON.stringify(patch) })
                    .then(() => setSaveStatus('saved'))
                    .catch(() => setSaveStatus('error'));
            }, SAVE_DELAY_MS),
        );
    }, []);

    const removePost = useCallback(async (postId: number) => {
        await request(`/api/shtab/post/${postId}`, { method: 'DELETE' });
        setState((prev) => (prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== postId) } : prev));
    }, []);

    /**
     * Принять стратегию: разбор закрывается вместе с отмеченными минусами одной
     * транзакцией на стороне базы. Перед этим дописываем несохранённые правки —
     * иначе закрытый разбор остался бы без последнего абзаца стратегии.
     */
    const closeRazbor = useCallback(
        async (minusIds: number[]) => {
            const id = activeIdRef.current;
            if (!id) return 0;
            await flush();
            const res = await request<{ closed_minuses: number }>(`/api/shtab/razbor/${id}/close`, {
                method: 'POST',
                body: JSON.stringify({ minus_ids: minusIds }),
            });
            setState((prev) =>
                prev
                    ? {
                          ...prev,
                          razbory: prev.razbory.map((r) =>
                              r.id === id ? { ...r, status: 'done', closes_minus_ids: minusIds } : r,
                          ),
                          minuses: prev.minuses.map((m) => (minusIds.includes(m.id) ? { ...m, done: true } : m)),
                      }
                    : prev,
            );
            return res.closed_minuses;
        },
        [flush],
    );

    const saveGoals = useCallback(async (goals: Partial<Record<GoalKind, string>>) => {
        const saved = await request<Record<GoalKind, string>>('/api/shtab/goals', {
            method: 'PUT',
            body: JSON.stringify(goals),
        });
        setState((prev) => (prev ? { ...prev, goals: saved } : prev));
    }, []);

    // Отложенные правки проектов и постов не должны уехать вместе с вкладкой.
    useEffect(() => {
        const projects = projectTimers.current;
        const posts = postTimers.current;
        return () => {
            projects.forEach(clearTimeout);
            posts.forEach(clearTimeout);
        };
    }, []);

    return {
        state,
        active,
        loadError,
        saveStatus,
        editRazbor,
        flush,
        addMinus,
        toggleMinus,
        newRazbor,
        openRazbor,
        saveGoals,
        addProject,
        patchProject,
        removeProject,
        addPost,
        patchPost,
        removePost,
        closeRazbor,
    };
}

export type Shtab = ReturnType<typeof useShtab>;
