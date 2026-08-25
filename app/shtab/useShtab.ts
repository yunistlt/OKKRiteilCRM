'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GoalKind, ShtabMinus, ShtabRazbor, ShtabState } from '@/lib/shtab/types';

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

    const saveGoals = useCallback(async (goals: Partial<Record<GoalKind, string>>) => {
        const saved = await request<Record<GoalKind, string>>('/api/shtab/goals', {
            method: 'PUT',
            body: JSON.stringify(goals),
        });
        setState((prev) => (prev ? { ...prev, goals: saved } : prev));
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
    };
}

export type Shtab = ReturnType<typeof useShtab>;
