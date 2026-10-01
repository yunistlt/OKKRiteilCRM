'use client';

/**
 * Утренний план: один раз за день показать его поверх всего.
 *
 * «Прочитано» помним в браузере по дате — это удобство одного человека на его
 * рабочем месте, а не данные. Пустым планом не мешаем: у руководителя без
 * задач отдела и у админа всплывать нечему.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MorningPlan } from './MorningPlanModal';

const STORAGE_KEY = 'morning-plan-read-on';

export function useMorningPlan(disabled: boolean) {
    const [morningPlan, setMorningPlan] = useState<MorningPlan | null>(null);
    const [today, setToday] = useState<string>('');

    useEffect(() => {
        if (disabled) return;

        let date: string;
        try {
            date = new Date().toISOString().slice(0, 10);
            if (window.localStorage.getItem(STORAGE_KEY) === date) return;
        } catch {
            // Память браузера недоступна — тогда окно не показываем вовсе,
            // иначе оно будет всплывать на каждой странице.
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const response = await fetch('/api/sales-rop/my-plan');
                const data = await response.json();
                if (cancelled || !response.ok || !data?.total) return;
                setToday(date);
                setMorningPlan(data as MorningPlan);
            } catch {
                // План не поднялся — утро не должно начинаться с ошибки.
            }
        })();

        return () => { cancelled = true; };
    }, [disabled]);

    const markRead = useCallback(() => {
        try {
            if (today) window.localStorage.setItem(STORAGE_KEY, today);
        } catch {
            // Не записалось — окно всплывёт ещё раз, это не страшно.
        }
        setMorningPlan(null);
    }, [today]);

    return { morningPlan, markRead };
}
