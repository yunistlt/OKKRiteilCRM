'use client';

/**
 * Хлебные крошки в шапке.
 *
 * Отдельной строки под крошки не заводим (требование владельца 02.10.2026):
 * название раздела в шапке и есть первая крошка, а экран, открытый поверх него
 * (карточка заказа, карточка клиента), добавляет к ней свою. Клик по разделу
 * возвращает на шаг назад — закрывает то, что открыто поверх.
 *
 * Почему через контекст: карточка живёт внутри страницы и знает, как себя
 * закрыть, а шапка — общая и о карточке ничего не знает.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Crumb = {
    /** Что написать: «Заказ #54911». */
    label: string;
    /** Вернуться на шаг назад — закрыть этот экран. Нет функции — крошка не кликается. */
    back?: () => void;
};

type BreadcrumbsState = {
    crumbs: Crumb[];
    /** Поставить крошки текущего экрана. Пустой список — крошек нет. */
    setCrumbs: (crumbs: Crumb[]) => void;
};

const BreadcrumbsContext = createContext<BreadcrumbsState>({ crumbs: [], setCrumbs: () => undefined });

export function useBreadcrumbs(): BreadcrumbsState {
    return useContext(BreadcrumbsContext);
}

export function BreadcrumbsProvider({ children }: { children: React.ReactNode }) {
    const [crumbs, setCrumbsState] = useState<Crumb[]>([]);

    const setCrumbs = useCallback((next: Crumb[]) => {
        setCrumbsState((prev) => {
            // Один и тот же набор ставится на каждый рендер карточки — не будим
            // шапку зря, иначе получаем бесконечный цикл перерисовок.
            const same =
                prev.length === next.length && prev.every((crumb, index) => crumb.label === next[index]?.label);
            return same ? prev : next;
        });
    }, []);

    const value = useMemo<BreadcrumbsState>(() => ({ crumbs, setCrumbs }), [crumbs, setCrumbs]);

    return <BreadcrumbsContext.Provider value={value}>{children}</BreadcrumbsContext.Provider>;
}
