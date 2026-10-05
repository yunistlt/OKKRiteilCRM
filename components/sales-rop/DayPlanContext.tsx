'use client';

/**
 * Открыт ли план дня на телефоне.
 *
 * На рабочем месте план висит постоянно — его не закрывают (решение владельца
 * 01.10.2026). На телефоне делить узкий экран нечем, поэтому там план
 * открывается поверх по кнопке в шапке, и это состояние живёт здесь.
 */
import { createContext, useContext, useMemo, useState } from 'react';

type DayPlanState = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

const DayPlanContext = createContext<DayPlanState>({ open: false, setOpen: () => undefined });

export function useDayPlan(): DayPlanState {
    return useContext(DayPlanContext);
}

export function DayPlanProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpenState] = useState(false);

    const value = useMemo<DayPlanState>(
        () => ({ open, setOpen: setOpenState }),
        [open],
    );

    return <DayPlanContext.Provider value={value}>{children}</DayPlanContext.Provider>;
}
