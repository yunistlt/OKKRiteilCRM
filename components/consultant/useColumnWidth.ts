'use client';

/**
 * Ширина правой колонки — плана дня и чата с Семёном.
 *
 * Ширину тянут мышью за левый край колонки, и она запоминается: у кого-то план
 * нужен широкий, кому-то важнее список заказов. Раньше тянулся сам чат, но
 * после того как над ним встал план, тянуть надо колонку целиком (требование
 * владельца 01.10.2026).
 *
 * Ключ хранения тот же, что был у чата: ширина у них общая, и после обновления
 * человек видит ту же колонку, что настроил раньше.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'okk_consultant_desktop_width';
// Минимум ужали на 30% (300 → 210): владельцу нужна максимальная рабочая
// область, а план и чат читаются и в узкой колонке (просьба 02.10.2026).
const MIN_WIDTH = 210;
const MAX_SHARE = 0.6;

function clamp(width: number): number {
    const max = typeof window === 'undefined' ? 720 : Math.round(window.innerWidth * MAX_SHARE);
    return Math.min(Math.max(Math.round(width), MIN_WIDTH), Math.max(MIN_WIDTH, max));
}

export function useColumnWidth(defaultWidth = 420) {
    const [width, setWidth] = useState<number>(defaultWidth);
    const draggingRef = useRef(false);

    useEffect(() => {
        try {
            const saved = Number(window.localStorage.getItem(STORAGE_KEY));
            if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
        } catch {
            // Память браузера недоступна — остаёмся на ширине по умолчанию.
        }
    }, []);

    useEffect(() => {
        const onMove = (event: PointerEvent) => {
            if (!draggingRef.current) return;
            const next = clamp(window.innerWidth - event.clientX);
            setWidth(next);
            try {
                window.localStorage.setItem(STORAGE_KEY, String(next));
            } catch {
                // Не запомнили — ширина всё равно применится на эту сессию.
            }
        };

        const onUp = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, []);

    const startResize = useCallback(() => {
        if (window.innerWidth < 768) return;
        draggingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    return { width, startResize };
}
