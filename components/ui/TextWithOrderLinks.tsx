'use client';

/**
 * Текст, в котором номера заказов сами становятся ссылками.
 *
 * Закон владельца 02.10.2026: номер заказа кликабелен везде, где человек его
 * видит. В теме письма он лежит внутри строки — «[#2/54776] Ирина Валерьевна
 * по заказу № 54776», — и до карточки приходилось добираться поиском
 * (замечание Жени Матвеевой 05.10.2026).
 */
import { Fragment } from 'react';
import OrderNumberLink from './OrderNumberLink';

/**
 * Что считаем номером заказа:
 *  - служебный тег темы «[#2/54776]» — номер после косой черты;
 *  - «заказ № 54776», «заказу 54776», «по заказу №54776»;
 *  - свои номера «900056».
 *
 * Просто любое пятизначное число брать нельзя: в теме попадаются суммы,
 * артикулы и даты, и каждая из них стала бы ссылкой в никуда.
 *
 * `\w` здесь не годится: в JavaScript он не знает русских букв, и «заказу»
 * молча не совпадало бы (известная грабля проекта).
 */
const PATTERN = /\[#\d+\/(\d{4,6})\]|(?:заказ[а-яё]*\s*№?\s*)(\d{4,6})|\b(9\d{5})\b/gi;

export default function TextWithOrderLinks({ text, className }: { text: string | null | undefined; className?: string }) {
    const value = String(text ?? '');
    if (!value) return null;

    const parts: Array<string | { number: string }> = [];
    let last = 0;

    // Обычный цикл, а не matchAll: сборка проекта идёт под старую цель, и
    // итератор совпадений в ней недоступен.
    const re = new RegExp(PATTERN.source, PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
        const number = match[1] || match[2] || match[3];
        if (!number) continue;

        const at = match.index ?? 0;
        // Сам номер внутри совпадения: «по заказу № 54776» → ссылкой только число.
        const numberAt = value.indexOf(number, at);
        if (numberAt > last) parts.push(value.slice(last, numberAt));
        parts.push({ number });
        last = numberAt + number.length;
    }


    if (!parts.length) return <span className={className}>{value}</span>;
    if (last < value.length) parts.push(value.slice(last));

    return (
        <span className={className}>
            {parts.map((part, i) =>
                typeof part === 'string'
                    ? <Fragment key={i}>{part}</Fragment>
                    : <OrderNumberLink key={i} number={part.number} />)}
        </span>
    );
}
