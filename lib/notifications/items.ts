/**
 * Что показывает лента оповещений — одним описанием для колокольчика и
 * страницы «Оповещения». Тип события и его подпись были написаны в обоих
 * местах и расходились при каждой правке.
 */

/** Чья задача: моя, коллеги или системная. */
export type TaskSource = 'mine' | 'colleague' | 'system';

export type NotificationItem = {
    id: string;
    kind: 'mail' | 'task' | 'call';
    at: string;
    text: string;
    /** Кто или что рядом: отправитель, срок, номер. */
    note: string | null;
    orderNumber: string | null;
    read: boolean;
    /** Только у задач: чья она. */
    taskSource?: TaskSource | null;
};

const KIND_LABEL: Record<NotificationItem['kind'], string> = {
    mail: 'Письмо',
    task: 'Задача',
    call: 'Звонок',
};

const TASK_LABEL: Record<TaskSource, string> = {
    mine: 'Моя задача',
    colleague: 'Задача',
    system: 'Задача системы',
};

/** Подпись события в ленте. */
export function itemLabel(item: NotificationItem): string {
    if (item.kind === 'task' && item.taskSource) return TASK_LABEL[item.taskSource];
    return KIND_LABEL[item.kind];
}

/**
 * Полоса слева: свою задачу видно цветом среди писем и звонков, и её не надо
 * выискивать глазами (просьба Елены Парфёновой 28.10.2026).
 */
export function itemAccent(item: NotificationItem): string {
    if (item.kind !== 'task') return '';
    if (item.taskSource === 'mine') return 'border-l-2 border-l-amber-500';
    if (item.taskSource === 'system') return 'border-l-2 border-l-gray-300';
    return '';
}

/** Задача в том виде, в каком она лежит в базе. */
export type TaskRow = {
    source?: string | null;
    created_by?: string | null;
    created_by_user_id?: string | null;
};

/** Тот, кто смотрит ленту. */
export type Viewer = {
    id: string;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
};

/**
 * Чья это задача с точки зрения смотрящего.
 *
 * Системную узнаём по колонке `source`, свою — по идентификатору автора.
 * У задач, поставленных до 01.11.2026, идентификатора нет: для них сверяемся
 * с текстом имени, которым система подписывала автора тогда — у кого-то это
 * почта, у кого-то фамилия.
 */
export function taskSourceOf(task: TaskRow, viewer: Viewer): TaskSource {
    if (task.source === 'system') return 'system';
    if (task.created_by_user_id) {
        return String(task.created_by_user_id) === String(viewer.id) ? 'mine' : 'colleague';
    }
    const by = String(task.created_by ?? '').trim().toLowerCase();
    if (!by) return 'colleague';
    const name = [viewer.first_name, viewer.last_name].filter(Boolean).join(' ').toLowerCase();
    const email = String(viewer.email ?? '').toLowerCase();
    return (name && by === name) || (email && by === email) ? 'mine' : 'colleague';
}
