'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

// ============================================================================
// «Текущий экран пользователя» для консультанта Семёна. Виджет глобальный и из
// URL видит только раздел (pathPrefix). Подразделы с client-side вкладками (напр.
// «Настройки мотивации → Грейды») в URL не отражаются, поэтому страница САМА
// сообщает человекочитаемую подсказку об активном экране через useConsultantScreenHint().
// Виджет читает её и отправляет как contextHint — бэкенд подсказывает Семёну, где
// искать ответ. Сбрасывается при смене маршрута, чтобы хинт не «прилипал».
// ============================================================================

type ConsultantScreenContextValue = {
    screenHint: string | null;
    setScreenHint: (hint: string | null) => void;
};

const ConsultantScreenContext = createContext<ConsultantScreenContextValue | null>(null);

export function ConsultantScreenProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [screenHint, setScreenHint] = useState<string | null>(null);

    // Смена маршрута сбрасывает подсказку (новая страница задаст свою).
    useEffect(() => {
        setScreenHint(null);
    }, [pathname]);

    const value = useMemo<ConsultantScreenContextValue>(() => ({ screenHint, setScreenHint }), [screenHint]);

    return <ConsultantScreenContext.Provider value={value}>{children}</ConsultantScreenContext.Provider>;
}

/** Хук чтения текущего экрана (для виджета). Безопасен вне провайдера — вернёт null. */
export function useConsultantScreen(): ConsultantScreenContextValue {
    return useContext(ConsultantScreenContext) ?? { screenHint: null, setScreenHint: () => {} };
}

/**
 * Объявить активный экран из страницы/вкладки. Ставит подсказку, пока компонент
 * смонтирован и hint не пуст; очищает при размонтировании или смене hint.
 * Пример: useConsultantScreenHint(`Настройки мотивации → ${tabLabel}`).
 */
export function useConsultantScreenHint(hint: string | null | undefined): void {
    const ctx = useContext(ConsultantScreenContext);
    useEffect(() => {
        if (!ctx) return;
        ctx.setScreenHint(hint && hint.trim() ? hint.trim() : null);
        return () => ctx.setScreenHint(null);
    }, [ctx, hint]);
}
