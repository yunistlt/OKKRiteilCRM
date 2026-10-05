/**
 * Что именно не так в правке карточки заказа — человеческим языком и с
 * привязкой к полю на экране.
 *
 * Женя Матвеева 05.10.2026: «Правка заполнена не верно. А где не верно? что
 * именно? не подсвечивается вообще». Раньше ответ был одной строкой без поля,
 * и менеджер искал ошибку перебором.
 *
 * Ключ поля — тот же, которым карточка хранит черновик: `cf.<код>` для
 * дополнительных полей, `contact.<имя>` и так далее. По нему карточка
 * подсвечивает нужную рамку.
 */
import type { ZodIssue } from 'zod';

export type FieldProblem = {
    /** Ключ поля в карточке — по нему подсвечиваем рамку. */
    field: string;
    /** Подпись поля, как её видит человек. */
    label: string;
    /** Что не так. */
    message: string;
};

/**
 * Имя поля в запросе → ключ черновика в карточке. Совпадают не все: единицу
 * срока карточка хранит своей колонкой, а запрос называет по-своему.
 */
const KEYS: Record<string, string> = {
    productionDaysUnit: 'order.srok_izgot_edinica',
    site: 'order.site',
};

/** Подписи полей — такие же, как в карточке заказа. */
const LABELS: Record<string, string> = {
    discountAmount: 'Скидка, ₽',
    discountPercent: 'Скидка, %',
    customerComment: 'Комментарий клиента',
    managerComment: 'Комментарий менеджера',
    statusCode: 'Статус',
    managerId: 'Менеджер',
    customerId: 'Заказчик',
    site: 'Магазин',
    productionDaysUnit: 'Дни считаем',
    items: 'Состав заказа',
    name: 'Название позиции',
    quantity: 'Количество',
    price: 'Цена',
};

/** Правило zod — словами, понятными менеджеру. */
function sayWhat(issue: ZodIssue): string {
    switch (issue.code) {
        case 'invalid_type':
            return 'тут должно быть число';
        case 'too_small':
            return 'значение слишком маленькое';
        case 'too_big':
            return 'значение слишком большое';
        case 'invalid_value':
            return 'выберите значение из списка';
        case 'invalid_format':
            return 'значение записано не в том виде';
        default:
            return issue.message || 'значение не подходит';
    }
}

export function fieldProblems(issues: ZodIssue[]): FieldProblem[] {
    return issues.map((issue) => {
        const path = issue.path.map(String);
        const [head, ...rest] = path;

        // Дополнительные поля заказа карточка хранит под `cf.<код>`.
        const field = KEYS[String(head)] ? KEYS[String(head)]
            : head === 'customFields' ? `cf.${rest.join('.')}`
            : head === 'contact' ? `contact.${rest.join('.')}`
            : head === 'contragent' ? `contragent.${rest.join('.')}`
            : path.join('.');

        const last = path[path.length - 1] ?? head ?? '';
        const label = LABELS[String(last)] || LABELS[String(head)] || String(last || head || 'Поле');

        return { field, label, message: sayWhat(issue) };
    });
}

/** Одна строка для тех мест, где показать можно только текст. */
export function problemsText(problems: FieldProblem[]): string {
    if (!problems.length) return 'Правка заполнена неверно';
    return problems.map((p) => `${p.label}: ${p.message}`).join('; ');
}
