'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StatusIcon from '@/components/orders/StatusIcon';

interface Option {
    code: string;
    name: string;
    color: string | null;
    groupName: string;
    groupColor: string | null;
    groupIcon: string | null;
    /** Разрешён ли переход в этот статус по матрице переходов. */
    allowed: boolean;
    current: boolean;
}

interface OrderStatusSwitcherProps {
    orderId: number | string;
    currentLabel?: string | null;
    /** Цвет этапа: кнопка статуса окрашивается в него, как в RetailCRM. */
    color?: string | null;
    onChanged?: (code: string) => void;
}

/** Та же краска, подмешанная к белому: фон блока этапа в списке. */
function tint(hex: string | null | undefined): string {
    const match = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!match) return '#f8fafc';

    const value = parseInt(match[1], 16);
    const mix = (channel: number) => Math.round(255 - (255 - channel) * 0.35);
    return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}

/** Цвет этапа, затемнённый до читаемого текста поверх его же заливки. */
function darken(hex: string | null | undefined): string {
    const match = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!match) return '#334155';

    const value = parseInt(match[1], 16);
    const mix = (channel: number) => Math.round(channel * 0.45);
    return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}

/** Белый или почти чёрный текст — по яркости цвета этапа. */
function readableOn(hex: string | null | undefined): string {
    const match = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!match) return '#111827';

    const value = parseInt(match[1], 16);
    const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
    return luminance > 0.72 ? '#111827' : '#ffffff';
}

/**
 * Смена статуса заказа из карточки. Показываем только те статусы, в которые разрешён
 * переход по нашей матрице, сгруппированные и окрашенные — как в RetailCRM.
 */
export default function OrderStatusSwitcher({ orderId, currentLabel, color, onChanged }: OrderStatusSwitcherProps) {
    const [open, setOpen] = useState(false);
    /**
     * Список рисуем поверх страницы, а не внутри полосы кнопок.
     *
     * Полоса кнопок в карточке прокручивается по горизонтали (`overflow-x-auto`)
     * и имеет высоту ~26px, поэтому выпадающий список обрезался ею начисто:
     * человек нажимал — и «ничего не происходило» (Андрей 02.10.2026).
     */
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{
        writeEnabled: boolean;
        currentName: string | null;
        known: boolean;
        transitionsConfigured: boolean;
        options: Option[];
    } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/status`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось получить переходы');
            setData(json);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось получить переходы');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => { if (open && !data) load(); }, [open, data, load]);

    // Позицию считаем от кнопки и держим при прокрутке страницы.
    useEffect(() => {
        if (!open) { setMenuBox(null); return; }
        const place = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = 320;
            setMenuBox({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [open]);

    const change = async (code: string) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: code }),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(
                    json.error === 'transition_not_allowed' ? 'Такой переход запрещён настройками статусов'
                    : json.error === 'status_not_mapped' ? 'Статус не сопоставлен с нашим справочником'
                    : json.error === 'crm_rejected' ? `RetailCRM отклонил смену статуса: ${json.details || 'без пояснения'}`
                    : 'Не удалось сменить статус'
                );
            }
            setOpen(false);
            setData(null);
            onChanged?.(code);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сменить статус');
        } finally {
            setSaving(false);
        }
    };

    // В списке только те статусы, куда переход разрешён матрицей, плюс текущий
    // (требование владельца 02.10.2026): весь каталог с серыми строками читался
    // как «всё сломано». Если из текущего статуса переходов нет вовсе —
    // показываем каталог целиком и честно пишем об этом выше.
    const anyAllowed = (data?.options || []).some((o) => o.allowed);
    const visibleOptions = anyAllowed
        ? (data?.options || []).filter((o) => o.allowed || o.current)
        : (data?.options || []);

    const grouped = visibleOptions.reduce<Record<string, Option[]>>((acc, o) => {
        (acc[o.groupName] ||= []).push(o);
        return acc;
    }, {});

    return (
        <div className="relative inline-block">
            <button
                ref={buttonRef}
                onClick={() => setOpen((v) => !v)}
                style={color ? { backgroundColor: color, color: readableOn(color), borderColor: color } : undefined}
                className="flex items-center gap-2 border border-gray-300 px-3 py-2 text-sm font-semibold hover:opacity-90"
            >
                <span>{currentLabel || 'Статус'}</span>
                <span className="opacity-70">▾</span>
            </button>

            {open && menuBox && createPortal(
                <>
                {/* Клик мимо списка закрывает его — как в любом меню. */}
                <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)} />
                <div
                    className="fixed z-[999] w-80 max-h-[70vh] overflow-y-auto border border-gray-200 bg-white shadow-lg"
                    style={{ top: menuBox.top, left: menuBox.left }}
                >
                    {loading && <p className="px-3 py-3 text-sm text-gray-500">Загружаем переходы…</p>}

                    {!loading && data && !data.writeEnabled && (
                        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
                            Отправка изменений в RetailCRM пока отключена — сначала достраиваем свой функционал.
                            Список ниже показывает разрешённые переходы, но смена не применится.
                        </p>
                    )}

                    {!loading && data && !data.transitionsConfigured && (
                        <p className="px-3 py-3 text-sm text-gray-600">
                            Переходы статусов ещё не настроены. Задайте их на экране «Статусы и переходы».
                        </p>
                    )}

                    {!loading && data?.transitionsConfigured && !data.known && (
                        <p className="px-3 py-3 text-sm text-gray-600">
                            Текущий статус не сопоставлен с нашим справочником, поэтому разрешённых переходов нет.
                        </p>
                    )}

                    {!loading && data?.known && !anyAllowed && (
                        <p className="border-b border-gray-200 px-3 py-2 text-xs leading-snug text-gray-600">
                            Из этого статуса переходы не настроены — список ниже показан целиком,
                            но перейти пока некуда. Переходы задаются на экране «Статусы и переходы».
                        </p>
                    )}

                    {/* Этапы цветными блоками, внутри — только разрешённые переходы. */}
                    {Object.entries(grouped).map(([groupName, options]) => (
                        <div key={groupName} style={{ backgroundColor: tint(options[0]?.groupColor) }}>
                            <p
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-bold"
                                style={{ color: darken(options[0]?.groupColor) }}
                            >
                                <StatusIcon icon={options[0]?.groupIcon} color={darken(options[0]?.groupColor)} size={14} />
                                {groupName}
                            </p>
                            {options.map((o) => (
                                <button
                                    key={o.code}
                                    onClick={() => o.allowed && change(o.code)}
                                    disabled={saving || !o.allowed || o.current}
                                    title={
                                        o.current
                                            ? 'Текущий статус заказа'
                                            : o.allowed
                                                ? `Перевести в «${o.name}»`
                                                : 'Переход в этот статус не настроен'
                                    }
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 pl-8 text-left text-[13px] ${
                                        o.current
                                            ? 'font-bold'
                                            : o.allowed
                                                ? 'hover:bg-white/60'
                                                : 'cursor-not-allowed opacity-40'
                                    }`}
                                    style={{ color: darken(options[0]?.groupColor) }}
                                >
                                    <span className="truncate">{o.name}</span>
                                    {o.current && <span className="ml-auto shrink-0 text-[11px]">сейчас</span>}
                                </button>
                            ))}
                        </div>
                    ))}

                    {error && <p className="border-t border-gray-200 px-3 py-2 text-xs text-red-700">{error}</p>}
                    {saving && <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">Меняем статус…</p>}
                </div>
                </>,
                document.body,
            )}
        </div>
    );
}
