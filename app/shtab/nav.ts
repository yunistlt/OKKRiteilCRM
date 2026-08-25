import type { TamaraController } from './Tamara';
import type { Shtab } from './useShtab';

export const VIEW_IDS = ['pult', 'minus', 'razbor', 'karta', 'strat', 'arch', 'celi', 'tamara'] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_TITLES: Record<ViewId, string> = {
    pult: 'Пульт',
    minus: 'Минусы',
    razbor: 'Разбор',
    karta: 'Карта ресурсов',
    strat: 'Стратегия',
    arch: 'Разборы',
    celi: 'Цели и посты',
    tamara: 'Тамара',
};

export type ViewProps = {
    shtab: Shtab;
    tamara: TamaraController;
    go: (view: ViewId) => void;
};
