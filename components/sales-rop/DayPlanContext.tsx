'use client';

/**
 * Открыт ли план дня.
 *
 * Открывается сам при первом входе за день — так же, как утреннее сообщение
 * бота: менеджер начинает день с плана, а не ищет его в переписке. Закрыл —
 * до завтра не мешаем, вернуть можно кнопкой (решение владельца 01.10.2026).
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type DayPlanState = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

const DayPlanContext = createContext<DayPlanState>({ open: false, setOpen: () => undefined });

const STORAGE_KEY = 'day-plan-shown-on';

export function useDayPlan(): DayPlanState {
    return useContext(DayPlanContext);
}

export function DayPlanProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpenState] = useState(false);

    useEffect(() => {
        // Показали сегодня — больше не выскакиваем. Память браузера тут уместна:
        // это удобство одного человека на одном рабочем месте, не данные.
        let today: string;
        try {
            today = new Date().toISOString().slice(0, 10);
            if (window.localStorage.getItem(STORAGE_KEY) === today) return;
        } catch {
            // Память браузера недоступна (приватное окно) — сами не открываем.
            return;
        }

        // Пустым планом не мешаем: у руководителя и админа своих задач нет.
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch('/api/sales-rop/my-plan');
                const data = await response.json();
                if (cancelled || !response.ok || !data?.total) return;
                setOpenState(true);
                window.localStorage.setItem(STORAGE_KEY, today);
            } catch {
                // План не поднялся — молча, утро не должно начинаться с ошибки.
            }
        })();

        return () => { cancelled = true; };
    }, []);

    const value = useMemo<DayPlanState>(
        () => ({ open, setOpen: setOpenState }),
        [open],
    );

    return <DayPlanContext.Provider value={value}>{children}</DayPlanContext.Provider>;
}
