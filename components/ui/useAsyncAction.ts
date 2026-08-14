'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Мгновенный отклик на клик (ЗАКОН, golds/GOLD_DESIGN_UX.md §2).
 *
 * Оборачивает асинхронный обработчик: пока он выполняется — элемент помечается
 * как «в работе», повторные клики игнорируются. Ключ нужен для списков, где
 * кнопки одинаковые, а нажали одну конкретную строку.
 *
 *   const { run, isPending } = useAsyncAction();
 *   <button onClick={() => run(`del:${id}`, () => remove(id))} disabled={isPending(`del:${id}`)}>
 *
 * Страховка: если запрос завис, индикатор снимается по таймауту (по умолчанию 60 с),
 * чтобы интерфейс не залипал навсегда.
 */
export function useAsyncAction(options?: { timeoutMs?: number }) {
    const timeoutMs = options?.timeoutMs ?? 60000;
    const [pendingKey, setPendingKey] = useState<string | null>(null);
    const pendingRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const clear = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        pendingRef.current = null;
        if (mountedRef.current) setPendingKey(null);
    }, []);

    const run = useCallback(
        async <T,>(key: string, action: () => T | Promise<T>): Promise<T | undefined> => {
            if (pendingRef.current) return undefined; // защита от двойного клика
            pendingRef.current = key;
            setPendingKey(key);
            timerRef.current = setTimeout(clear, timeoutMs);
            try {
                return await action();
            } finally {
                clear();
            }
        },
        [clear, timeoutMs],
    );

    const isPending = useCallback((key?: string) => (key === undefined ? pendingKey !== null : pendingKey === key), [pendingKey]);

    return { run, isPending, pendingKey, anyPending: pendingKey !== null };
}
