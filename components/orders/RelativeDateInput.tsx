'use client';

/**
 * Поле даты с относительным выбором — как в RetailCRM.
 *
 * Менеджер почти никогда не помнит нужное число: он думает «неделю назад»,
 * «вчера», «через месяц». В RetailCRM у каждого поля даты есть такой список.
 *
 * Важно, что выбранное смещение так и остаётся смещением: фильтр хранит
 * `rel:-7d`, а в дату это разворачивается в момент запроса. Поэтому
 * сохранённый фильтр «заказы на завтра» завтра означает уже другой день, а не
 * то число, когда его сохранили (требование владельца 01.10.2026).
 */
import { useEffect, useRef, useState } from 'react';
import { isRelative, relativeLabel, relativeToken, type RelativeUnit } from '@/lib/relative-date';

type Unit = RelativeUnit;

const UNITS: Array<{ code: Unit; label: string }> = [
    { code: 'd', label: 'дн' },
    { code: 'w', label: 'нед' },
    { code: 'm', label: 'мес' },
    { code: 'y', label: 'лет' },
];

/** Быстрые смещения — тот же набор, что в RetailCRM. */
const QUICK: Array<{ label: string; amount: number; unit: Unit }> = [
    { label: '1 год', amount: 1, unit: 'y' },
    { label: 'полгода', amount: 6, unit: 'm' },
    { label: '3 месяца', amount: 3, unit: 'm' },
    { label: '2 месяца', amount: 2, unit: 'm' },
    { label: '1 месяц', amount: 1, unit: 'm' },
    { label: '3 недели', amount: 3, unit: 'w' },
    { label: '2 недели', amount: 2, unit: 'w' },
    { label: '1 неделя', amount: 1, unit: 'w' },
    { label: '6 дней', amount: 6, unit: 'd' },
    { label: '5 дней', amount: 5, unit: 'd' },
    { label: '4 дня', amount: 4, unit: 'd' },
    { label: '3 дня', amount: 3, unit: 'd' },
    { label: '2 дня', amount: 2, unit: 'd' },
    { label: '1 день', amount: 1, unit: 'd' },
];

export default function RelativeDateInput({
    value,
    onChange,
    title,
}: {
    value: string;
    onChange: (value: string) => void;
    title?: string;
}) {
    const [open, setOpen] = useState(false);
    const [backAmount, setBackAmount] = useState('0');
    const [backUnit, setBackUnit] = useState<Unit>('d');
    const [forwardAmount, setForwardAmount] = useState('0');
    const [forwardUnit, setForwardUnit] = useState<Unit>('d');
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocumentClick = (event: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocumentClick);
        return () => document.removeEventListener('mousedown', onDocumentClick);
    }, [open]);

    const pick = (amount: number, unit: Unit, direction: -1 | 1) => {
        // Храним смещение, а не дату: иначе сохранённый фильтр завтра покажет
        // вчерашнее (в RetailCRM он остаётся живым).
        onChange(relativeToken(amount, unit, direction));
        setOpen(false);
    };

    const relative = isRelative(value);

    return (
        <div className="relative w-full min-w-0" ref={boxRef}>
            <div className="flex items-center">
                {relative ? (
                    // Смещение показываем словами: «7 дней назад» понятнее, чем дата,
                    // которая завтра станет другой.
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        title={title}
                        className="w-full min-w-0 truncate border border-blue-400 bg-blue-50 px-1 py-1 text-left text-xs font-semibold text-blue-800"
                    >
                        {relativeLabel(value)}
                    </button>
                ) : (
                    <input
                        type="date"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        title={title}
                        className="w-full min-w-0 border border-gray-400 px-1 py-1 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                    />
                )}
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    title="Выбрать относительно сегодня"
                    className="shrink-0 border border-l-0 border-gray-400 px-1 py-1 text-[10px] text-blue-700 hover:bg-gray-50"
                >
                    ▾
                </button>
            </div>

            {open && (
                <div className="absolute left-0 top-full z-40 mt-0.5 w-64 border border-gray-300 bg-white p-2 shadow-lg">
                    <Section
                        title="Назад:"
                        amount={backAmount}
                        unit={backUnit}
                        onAmount={setBackAmount}
                        onUnit={setBackUnit}
                        onApply={() => pick(Number(backAmount) || 0, backUnit, -1)}
                        onQuick={(q) => pick(q.amount, q.unit, -1)}
                        quick={QUICK}
                    />

                    <button
                        type="button"
                        onClick={() => pick(0, 'd', 1)}
                        className="my-1 block w-full px-1 py-1 text-left text-xs font-bold text-blue-700 hover:bg-blue-50"
                    >
                        Сегодня
                    </button>

                    <Section
                        title="Вперёд:"
                        amount={forwardAmount}
                        unit={forwardUnit}
                        onAmount={setForwardAmount}
                        onUnit={setForwardUnit}
                        onApply={() => pick(Number(forwardAmount) || 0, forwardUnit, 1)}
                        onQuick={(q) => pick(q.amount, q.unit, 1)}
                        quick={[...QUICK].reverse()}
                    />

                    <button
                        type="button"
                        onClick={() => { onChange(''); setOpen(false); }}
                        className="mt-1 block w-full border-t border-gray-200 px-1 pt-2 text-left text-xs text-gray-600 hover:text-red-600"
                    >
                        ✕ Сбросить
                    </button>
                </div>
            )}
        </div>
    );
}

function Section({
    title,
    amount,
    unit,
    onAmount,
    onUnit,
    onApply,
    onQuick,
    quick,
}: {
    title: string;
    amount: string;
    unit: Unit;
    onAmount: (v: string) => void;
    onUnit: (v: Unit) => void;
    onApply: () => void;
    onQuick: (q: { amount: number; unit: Unit }) => void;
    quick: Array<{ label: string; amount: number; unit: Unit }>;
}) {
    return (
        <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">{title}</p>
            <div className="mb-1 flex items-center gap-1">
                <input
                    value={amount}
                    onChange={(e) => onAmount(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    className="w-12 border border-gray-400 px-1 py-0.5 text-xs"
                />
                <select
                    value={unit}
                    onChange={(e) => onUnit(e.target.value as Unit)}
                    className="border border-gray-400 bg-white px-1 py-0.5 text-xs"
                >
                    {UNITS.map((u) => (
                        <option key={u.code} value={u.code}>{u.label}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={onApply}
                    title="Применить"
                    className="border border-green-600 px-1.5 py-0.5 text-xs font-bold text-green-700 hover:bg-green-50"
                >
                    ✓
                </button>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {quick.map((q) => (
                    <button
                        key={`${q.label}-${title}`}
                        type="button"
                        onClick={() => onQuick(q)}
                        className="text-xs text-blue-700 hover:underline"
                    >
                        {q.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
