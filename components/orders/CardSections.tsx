'use client';

/**
 * Сворачивание блоков карточки заказа с памятью за человеком.
 *
 * Лена Парфёнова 05.10.2026: «большая портянка на экране, всё раскидано, не
 * удобно работать. Чтобы оставались видны основные нужные поля и комменты».
 * Владелец: сворачивать можно, и состояние запоминать — чтобы после обновления
 * страницы не сворачивать заново.
 *
 * Состояние лежит там же, где колонки списка и поля фильтра — в личных
 * настройках экрана (`/api/settings/view`), поэтому переезжает за человеком на
 * другой компьютер, а не живёт в одном браузере.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

const VIEW_KEY = 'orders.card.sections';

type SectionsState = {
    isCollapsed: (id: string) => boolean;
    toggle: (id: string) => void;
};

const SectionsContext = createContext<SectionsState>({ isCollapsed: () => false, toggle: () => {} });

export function CardSectionsProvider({ children }: { children: ReactNode }) {
    const [collapsed, setCollapsed] = useState<string[]>([]);
    /** Пока не прочитали настройку — не сохраняем, иначе затрём её пустотой. */
    const loaded = useRef(false);

    useEffect(() => {
        fetch(`/api/settings/view?viewKey=${VIEW_KEY}`)
            .then((r) => r.json())
            .then((d) => {
                const saved = d?.settings?.collapsed;
                if (Array.isArray(saved)) setCollapsed(saved.filter((id: unknown) => typeof id === 'string'));
            })
            .catch(() => undefined)
            .finally(() => { loaded.current = true; });
    }, []);

    const toggle = useCallback((id: string) => {
        setCollapsed((current) => {
            const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
            if (loaded.current) {
                void fetch('/api/settings/view', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viewKey: VIEW_KEY, settings: { collapsed: next } }),
                }).catch(() => undefined);
            }
            return next;
        });
    }, []);

    const isCollapsed = useCallback((id: string) => collapsed.includes(id), [collapsed]);

    return <SectionsContext.Provider value={{ isCollapsed, toggle }}>{children}</SectionsContext.Provider>;
}

/**
 * Блок карточки с заголовком-переключателем. Заголовок виден всегда — по нему
 * человек понимает, что блок свёрнут, а не пропал.
 */
export function CardSection({
    id,
    title,
    action,
    children,
}: {
    id: string;
    title: string;
    /** Ссылки и кнопки блока — показываем только в развёрнутом виде. */
    action?: ReactNode;
    children: ReactNode;
}) {
    const { isCollapsed, toggle } = useContext(SectionsContext);
    const collapsed = isCollapsed(id);

    return (
        <div className="border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-2">
                <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="flex items-center gap-2 text-left"
                    title={collapsed ? 'Развернуть' : 'Свернуть'}
                >
                    <span className="text-xs text-gray-400">{collapsed ? '▸' : '▾'}</span>
                    <span className="text-base font-semibold text-gray-900">{title}</span>
                </button>
                {!collapsed && action}
            </div>
            {!collapsed && <div className="px-4 pb-4">{children}</div>}
        </div>
    );
}
