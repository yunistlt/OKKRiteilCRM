'use client';

import * as React from 'react';
import { cn } from '@/utils/cn';
import { formatNumberRu } from '@/lib/format';

/**
 * Числовое поле ввода с разделителями разрядов прямо во время набора
 * («20 000 000»). Наружу через onChange отдаёт чистое число (или emptyValue
 * при пустом поле). Сохраняет позицию курсора при автоформатировании.
 *
 * Используйте вместо <input type="number"> для сумм/количеств — см.
 * golds/GOLD_UI_TABLES.md (Data Formatting) и lib/format.ts.
 */
export interface NumberInputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
    value: number | null | undefined;
    onChange: (value: number | null) => void;
    /** Максимум знаков после запятой (по умолчанию 0 — целое число). */
    maxFractionDigits?: number;
    /** Что отдавать наружу при пустом поле (по умолчанию null). */
    emptyValue?: number | null;
}

/** Сколько значащих символов (цифр) слева от позиции в строке. */
function digitsBefore(str: string, pos: number): number {
    let count = 0;
    for (let i = 0; i < pos && i < str.length; i++) {
        if (str[i] >= '0' && str[i] <= '9') count++;
    }
    return count;
}

/** Позиция в отформатированной строке после n-й цифры. */
function posAfterDigits(str: string, n: number): number {
    if (n <= 0) {
        // поставить курсор после ведущего минуса, если он есть
        return str.startsWith('-') ? 1 : 0;
    }
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] >= '0' && str[i] <= '9') {
            count++;
            if (count === n) return i + 1;
        }
    }
    return str.length;
}

/** Разбирает сырой ввод в форматированный текст и числовое значение. */
function formatRaw(raw: string, maxFractionDigits: number): { text: string; num: number | null } {
    const neg = /^\s*-/.test(raw);
    const s = raw.replace(/[^\d.,]/g, '');
    const firstSep = s.search(/[.,]/);

    let intPart = '';
    let fracPart = '';
    let hasSep = false;

    if (maxFractionDigits > 0 && firstSep >= 0) {
        hasSep = true;
        intPart = s.slice(0, firstSep).replace(/[.,]/g, '');
        fracPart = s.slice(firstSep + 1).replace(/[.,]/g, '').slice(0, maxFractionDigits);
    } else {
        intPart = s.replace(/[.,]/g, '');
    }

    intPart = intPart.replace(/^0+(?=\d)/, ''); // убрать ведущие нули

    const intFormatted = intPart === '' ? '' : Number(intPart).toLocaleString('ru-RU');

    let text = intFormatted;
    if (hasSep) text = `${intFormatted === '' ? '0' : intFormatted},${fracPart}`;
    if (neg && text !== '') text = `-${text}`;

    const numStr =
        (neg ? '-' : '') +
        (intPart === '' ? (hasSep ? '0' : '') : intPart) +
        (hasSep && fracPart ? `.${fracPart}` : '');
    const parsed = numStr === '' || numStr === '-' ? null : Number(numStr);

    return { text, num: parsed != null && Number.isFinite(parsed) ? parsed : null };
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
    { value, onChange, maxFractionDigits = 0, emptyValue = null, className, onFocus, onBlur, ...rest },
    forwardedRef,
) {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRef = (el: HTMLInputElement | null) => {
        innerRef.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    const [focused, setFocused] = React.useState(false);
    const [text, setText] = React.useState('');

    const displayFromValue = React.useMemo(() => {
        if (value === null || value === undefined || (value as unknown) === '') return '';
        return formatNumberRu(value, { maximumFractionDigits: maxFractionDigits });
    }, [value, maxFractionDigits]);

    const display = focused ? text : displayFromValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const el = e.target;
        const raw = el.value;
        const caret = el.selectionStart ?? raw.length;
        const dBefore = digitsBefore(raw, caret);

        const { text: formatted, num } = formatRaw(raw, maxFractionDigits);
        setText(formatted);
        onChange(num === null ? emptyValue : num);

        // восстановить позицию курсора после перерисовки
        requestAnimationFrame(() => {
            const node = innerRef.current;
            if (!node) return;
            const pos = posAfterDigits(formatted, dBefore);
            try {
                node.setSelectionRange(pos, pos);
            } catch {
                /* поле могло потерять фокус */
            }
        });
    };

    return (
        <input
            {...rest}
            ref={setRef}
            type="text"
            inputMode={maxFractionDigits > 0 ? 'decimal' : 'numeric'}
            value={display}
            onChange={handleChange}
            onFocus={(e) => {
                setFocused(true);
                setText(displayFromValue);
                onFocus?.(e);
            }}
            onBlur={(e) => {
                setFocused(false);
                onBlur?.(e);
            }}
            className={cn(className)}
        />
    );
});
