'use client';

/**
 * Поле на несколько строк, которое растёт под содержимое.
 *
 * Зачем: длинный текст в маленьком окошке не прочитать целиком, а обрезанное
 * значение нельзя проверить глазами (замечание владельца 05.10.2026 про
 * юридический адрес). Евгения Матвеева 15.10.2026 — про комментарий клиента:
 * «очень маленькое окошко, оно растягивается, но после каждого сохранения
 * снова становится маленьким». Поэтому высоту держит не человек мышкой, а
 * само поле: после сохранения и повторного открытия карточки она такая же.
 *
 * Жило в карточке клиента, вынесено сюда, чтобы второй копии не заводить.
 */
import { useEffect, useRef } from 'react';

type Props = {
    value: string;
    onChange: (value: string) => void;
    /** Минимальная высота, когда текста ещё нет. */
    rows?: number;
    placeholder?: string;
    className?: string;
    /** Докуда растём; дальше у поля появляется своя прокрутка. */
    maxHeightPx?: number;
};

export default function AutoTextarea({
    value, onChange, rows = 2, placeholder, className, maxHeightPx,
}: Props) {
    const ref = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        const wanted = el.scrollHeight;
        if (maxHeightPx && wanted > maxHeightPx) {
            el.style.height = `${maxHeightPx}px`;
            el.style.overflowY = 'auto';
        } else {
            el.style.height = `${wanted}px`;
            el.style.overflowY = 'hidden';
        }
    }, [value, maxHeightPx]);

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className={className ?? 'w-full resize-y overflow-hidden border border-gray-300 px-2 py-1'}
        />
    );
}
