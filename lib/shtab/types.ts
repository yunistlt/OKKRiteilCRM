// Общие типы «Штаба» — используются и серверными маршрутами, и страницей.

export type ShtabArea = {
    code: string;
    title: string;
    ordinal: number;
};

/** Откуда пришёл минус. Коды технические, подписи — в SOURCE_TITLES. */
export type MinusSource = 'owner' | 'data' | 'telegram';

export const MINUS_SOURCES: MinusSource[] = ['owner', 'data', 'telegram'];

export const SOURCE_TITLES: Record<MinusSource, string> = {
    owner: 'ты',
    data: 'данные',
    telegram: 'телеграм',
};

export type ShtabMinus = {
    id: number;
    text: string;
    area_code: string;
    source: MinusSource;
    occurred_on: string;
    done: boolean;
};

export type RazborStatus = 'draft' | 'done';

/** Колонка карты ресурсов: чего нет и чем это добывают. */
export type ShtabResource = {
    ordinal: number;
    missing: string;
    available: string[];
};

export type ShtabRazbor = {
    id: number;
    area_code: string;
    status: RazborStatus;
    minus_id: number | null;
    situation: string;
    why: string;
    /** null — владелец ещё не отвечал на проверку */
    check_inside: boolean | null;
    check_res: boolean | null;
    check_relief: boolean | null;
    goal_fix: string;
    goal_grow: string;
    strategy: string;
    created_at: string;
    resources: ShtabResource[];
    /** Минусы, которые разбор берётся закрыть своей стратегией. */
    closes_minus_ids: number[];
    projects: ShtabProject[];
};

export type ProjectStatus = 'open' | 'done' | 'dropped';

/** Дело, вытекающее из стратегии: со сроком и ответственным, иначе это пожелание. */
export type ShtabProject = {
    id: number;
    razbor_id: number;
    ordinal: number;
    title: string;
    owner_name: string;
    due_on: string | null;
    status: ProjectStatus;
    note: string;
};

/**
 * Пост — не сотрудник. У поста своё образцовое положение дел и своя еженедельная
 * статистика; holder_name — подпись, а не ссылка на пользователя, потому что один
 * человек занимает несколько постов, а пост может стоять вакантным.
 */
export type ShtabPost = {
    id: number;
    title: string;
    area_code: string | null;
    ideal_scene: string;
    statistic: string;
    holder_name: string;
    external_uid: string | null;
    ordinal: number;
};

export type GoalKind = 'company' | 'owner' | 'product';

export const GOAL_KINDS: GoalKind[] = ['company', 'owner', 'product'];

export type ShtabState = {
    areas: ShtabArea[];
    minuses: ShtabMinus[];
    razbory: ShtabRazbor[];
    posts: ShtabPost[];
    goals: Record<GoalKind, string>;
};

/** Каким разбором закрыт минус. Пусто — закрыт руками, вне разбора. */
export function closedByRazbor(minusId: number, razbory: ShtabRazbor[]): ShtabRazbor | null {
    return razbory.find((r) => r.status === 'done' && r.closes_minus_ids.includes(minusId)) ?? null;
}

/** Шесть шагов разбора — по ним считается прогресс на Пульте. */
export function razborProgress(r: ShtabRazbor | null | undefined): number {
    if (!r) return 0;
    const steps = [
        Boolean(r.situation.trim()),
        Boolean(r.why.trim()),
        r.check_inside === true && r.check_res === true && r.check_relief === true,
        Boolean(r.goal_fix.trim() && r.goal_grow.trim()),
        r.resources.length > 0,
        Boolean(r.strategy.trim()),
    ];
    return steps.filter(Boolean).length;
}

export const RAZBOR_STEPS = 6;

/**
 * Приоритетная область — та, где больше всего открытых минусов.
 * При равенстве выигрывает область с меньшим ordinal, чтобы порядок не прыгал
 * от запроса к запросу.
 */
export function topArea(
    areas: ShtabArea[],
    minuses: ShtabMinus[],
): { area: ShtabArea | null; count: number; counts: Record<string, number> } {
    const counts: Record<string, number> = {};
    for (const a of areas) counts[a.code] = 0;
    for (const m of minuses) {
        if (!m.done && Object.prototype.hasOwnProperty.call(counts, m.area_code)) counts[m.area_code]++;
    }

    let best: ShtabArea | null = null;
    for (const a of [...areas].sort((x, y) => x.ordinal - y.ordinal)) {
        if (!best || counts[a.code] > counts[best.code]) best = a;
    }
    return { area: best, count: best ? counts[best.code] : 0, counts };
}
