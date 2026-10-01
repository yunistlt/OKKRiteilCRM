'use client';

/**
 * Поле даты в фильтрах — с календарём и относительным выбором, как в RetailCRM.
 *
 * Нативное поле `type="date"` выглядело криво: обрезанный текст «01.10.202…»,
 * чужая иконка внутри и разный вид в каждом браузере. Поэтому поле своё:
 * показывает дату по-русски, а по иконке открывается календарь.
 *
 * Второе окно того же поповера — относительные даты («неделю назад», «через
 * месяц»). Смещение так и хранится смещением (`rel:-7d`) и превращается в дату
 * в момент запроса, поэтому сохранённый фильтр «заказы на завтра» завтра
 * означает другой день (требование владельца 01.10.2026).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Дата по-русски: 01.10.2026. Пустое и смещение сюда не попадают. */
function humanDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

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
    const [mode, setMode] = useState<'calendar' | 'relative'>('calendar');
    // Окно календаря рисуем поверх всей страницы: внутри панели фильтра его
    // срезала область прокрутки и колонка справа.
    const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    const relative = isRelative(value);
    const shown = relative ? relativeLabel(value) : humanDate(value);

    useEffect(() => {
        if (!open) return;

        const onDocumentClick = (event: MouseEvent) => {
            const target = event.target as Node;
            const insideField = boxRef.current?.contains(target);
            const insidePopup = popupRef.current?.contains(target);
            if (!insideField && !insidePopup) setOpen(false);
        };

        // Страница прокрутилась — окно уехало бы от своего поля, проще закрыть.
        const onScroll = () => setOpen(false);

        document.addEventListener('mousedown', onDocumentClick);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            document.removeEventListener('mousedown', onDocumentClick);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [open]);

    const WIDTH = 260;

    const toggle = () => {
        if (!open && boxRef.current) {
            const rect = boxRef.current.getBoundingClientRect();
            // Не вылезаем за правый край окна и не прячемся под чужими панелями.
            const left = Math.min(rect.left, window.innerWidth - WIDTH - 8);
            setAnchor({ top: rect.bottom + 4, left: Math.max(8, left) });
        }
        setOpen((v) => !v);
    };

    const pick = (amount: number, unit: Unit, direction: -1 | 1) => {
        onChange(relativeToken(amount, unit, direction));
        setOpen(false);
    };

    return (
        <div className="relative w-full min-w-0" ref={boxRef}>
            <button
                type="button"
                onClick={toggle}
                title={title}
                className={`flex h-[30px] w-full min-w-0 items-center justify-between gap-1 border px-2 text-left text-xs ${
                    open ? 'border-blue-500' : 'border-gray-400'
                } ${relative ? 'bg-blue-50 font-semibold text-blue-800' : 'bg-white text-gray-800'} hover:border-blue-500`}
            >
                <span className="truncate">{shown || <span className="text-gray-400">дд.мм.гггг</span>}</span>
                <CalendarGlyph active={open} />
            </button>

            {open && anchor && typeof document !== 'undefined' && createPortal(
                <div
                    ref={popupRef}
                    style={{ top: anchor.top, left: anchor.left, width: WIDTH }}
                    className="fixed z-[200] border border-gray-300 bg-white shadow-xl"
                >
                    {mode === 'calendar' ? (
                        <Calendar
                            value={relative ? '' : value}
                            onPick={(iso) => { onChange(iso); setOpen(false); }}
                            onClear={() => { onChange(''); setOpen(false); }}
                        />
                    ) : (
                        <RelativeList onPick={pick} onClear={() => { onChange(''); setOpen(false); }} />
                    )}

                    <button
                        type="button"
                        onClick={() => setMode(mode === 'calendar' ? 'relative' : 'calendar')}
                        className="w-full border-t border-gray-200 bg-gray-50 py-2 text-center text-xs font-semibold text-blue-700 underline-offset-2 hover:underline"
                    >
                        {mode === 'calendar' ? 'Относительные даты' : 'Календарь'}
                    </button>
                </div>,
                document.body,
            )}
        </div>
    );
}

/** Иконка календаря — та же роль, что синяя иконка у поля в RetailCRM. */
function CalendarGlyph({ active }: { active: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={active ? '#2563eb' : '#64748b'}
            strokeWidth="2.2"
            className="shrink-0"
            aria-hidden="true"
        >
            <rect x="3" y="5" width="18" height="16" rx="1" />
            <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
    );
}

function Calendar({
    value,
    onPick,
    onClear,
}: {
    value: string;
    onPick: (iso: string) => void;
    onClear: () => void;
}) {
    const today = new Date();
    const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : null;
    const [cursor, setCursor] = useState(() => new Date((selected ?? today).getFullYear(), (selected ?? today).getMonth(), 1));

    const days = useMemo(() => {
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        // Неделя начинается с понедельника — как у нас принято.
        const shift = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(first.getDate() - shift);

        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });
    }, [cursor]);

    const years = useMemo(() => {
        const base = today.getFullYear();
        return Array.from({ length: 11 }, (_, i) => base - 5 + i);
    }, [today]);

    return (
        <div className="p-2">
            <div className="mb-2 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                    className="px-1.5 py-0.5 text-sm text-gray-500 hover:text-gray-900"
                    title="Предыдущий месяц"
                >
                    ‹
                </button>
                <select
                    value={cursor.getMonth()}
                    onChange={(e) => setCursor(new Date(cursor.getFullYear(), Number(e.target.value), 1))}
                    className="flex-1 border border-gray-300 bg-white px-1 py-0.5 text-xs"
                >
                    {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select
                    value={cursor.getFullYear()}
                    onChange={(e) => setCursor(new Date(Number(e.target.value), cursor.getMonth(), 1))}
                    className="border border-gray-300 bg-white px-1 py-0.5 text-xs"
                >
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <button
                    type="button"
                    onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                    className="px-1.5 py-0.5 text-sm text-gray-500 hover:text-gray-900"
                    title="Следующий месяц"
                >
                    ›
                </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w) => (
                    <div key={w} className="py-1 text-[10px] font-semibold uppercase text-gray-400">{w}</div>
                ))}
                {days.map((date) => {
                    const iso = toIso(date);
                    const otherMonth = date.getMonth() !== cursor.getMonth();
                    const isToday = iso === toIso(today);
                    const isSelected = selected && iso === toIso(selected);
                    const weekend = date.getDay() === 0 || date.getDay() === 6;

                    return (
                        <button
                            key={iso}
                            type="button"
                            onClick={() => onPick(iso)}
                            className={`h-7 text-xs ${
                                isSelected
                                    ? 'bg-blue-600 font-bold text-white'
                                    : isToday
                                        ? 'bg-gray-900 font-bold text-white'
                                        : otherMonth
                                            ? 'text-gray-300 hover:bg-gray-100'
                                            : weekend
                                                ? 'text-blue-600 hover:bg-blue-50'
                                                : 'text-gray-800 hover:bg-blue-50'
                            }`}
                        >
                            {date.getDate()}
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                onClick={onClear}
                className="mt-2 w-full py-1 text-center text-xs text-gray-600 hover:text-red-600"
            >
                ✕ Сбросить
            </button>
        </div>
    );
}

function RelativeList({
    onPick,
    onClear,
}: {
    onPick: (amount: number, unit: Unit, direction: -1 | 1) => void;
    onClear: () => void;
}) {
    const [backAmount, setBackAmount] = useState('0');
    const [backUnit, setBackUnit] = useState<Unit>('d');
    const [forwardAmount, setForwardAmount] = useState('0');
    const [forwardUnit, setForwardUnit] = useState<Unit>('d');

    return (
        <div className="p-2">
            <Section
                title="Назад:"
                amount={backAmount}
                unit={backUnit}
                onAmount={setBackAmount}
                onUnit={setBackUnit}
                onApply={() => onPick(Number(backAmount) || 0, backUnit, -1)}
                onQuick={(q) => onPick(q.amount, q.unit, -1)}
                quick={QUICK}
            />

            <button
                type="button"
                onClick={() => onPick(0, 'd', 1)}
                className="my-1.5 block w-full py-1 text-left text-xs font-bold text-blue-700 hover:bg-blue-50"
            >
                Сегодня
            </button>

            <Section
                title="Вперёд:"
                amount={forwardAmount}
                unit={forwardUnit}
                onAmount={setForwardAmount}
                onUnit={setForwardUnit}
                onApply={() => onPick(Number(forwardAmount) || 0, forwardUnit, 1)}
                onQuick={(q) => onPick(q.amount, q.unit, 1)}
                quick={[...QUICK].reverse()}
            />

            <button
                type="button"
                onClick={onClear}
                className="mt-2 w-full py-1 text-center text-xs text-gray-600 hover:text-red-600"
            >
                ✕ Сбросить
            </button>
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
            <div className="mb-1.5 flex items-center gap-1">
                <input
                    value={amount}
                    onChange={(e) => onAmount(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    className="h-7 w-12 border border-gray-400 px-1 text-xs"
                />
                <select
                    value={unit}
                    onChange={(e) => onUnit(e.target.value as Unit)}
                    className="h-7 border border-gray-400 bg-white px-1 text-xs"
                >
                    {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                </select>
                <button
                    type="button"
                    onClick={onApply}
                    title="Применить"
                    className="h-7 border border-green-600 px-2 text-xs font-bold text-green-700 hover:bg-green-50"
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
