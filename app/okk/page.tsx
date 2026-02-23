'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface OrderScore {
    order_id: number;
    created_at?: string;
    manager_id: number | null;
    mop_name: string | null;
    order_status: string | null;
    eval_date: string | null;
    lead_in_work_lt_1_day: boolean | null;
    next_contact_not_overdue: boolean | null;
    lead_in_work_lt_1_day_after_tz: boolean | null;
    deal_in_status_lt_5_days: boolean | null;
    time_to_first_contact: string | null;
    tz_received: boolean | null;
    field_buyer_filled: boolean | null;
    field_product_category: boolean | null;
    field_contact_data: boolean | null;
    relevant_number_found: boolean | null;
    field_expected_amount: boolean | null;
    field_purchase_form: boolean | null;
    field_sphere_correct: boolean | null;
    mandatory_comments: boolean | null;
    email_sent_no_answer: boolean | null;
    calls_status: string | null;
    calls_total_duration: string | null;
    calls_attempts_count: number | null;
    calls_evaluated_count: number | null;
    script_greeting: boolean | null;
    script_call_purpose: boolean | null;
    script_company_info: boolean | null;
    script_deadlines: boolean | null;
    script_tz_confirmed: boolean | null;
    script_objection_general: boolean | null;
    script_objection_delays: boolean | null;
    script_offer_best_tech: boolean | null;
    script_offer_best_terms: boolean | null;
    script_offer_best_price: boolean | null;
    script_cross_sell: boolean | null;
    script_next_step_agreed: boolean | null;
    script_dialogue_management: boolean | null;
    script_confident_speech: boolean | null;
    deal_score: number | null;
    deal_score_pct: number | null;
    script_score: number | null;
    script_score_pct: number | null;
    total_score: number | null;
    evaluator_comment: string | null;
    score_breakdown: Record<string, { result: boolean | null, reason: string | null }> | null;
    manager_name?: string;
    status_label?: string;
    status_color?: string;
}

// ─── Вспомогательные функции ──────────────────────────────
function getBadgeStyle(hex?: string) {
    if (!hex) return { backgroundColor: '#F3F4F6', color: '#374151' };

    // Проверяем контрастность (YIQ)
    let r = 0, g = 0, b = 0;
    if (hex.startsWith('#')) {
        if (hex.length === 7) {
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        } else if (hex.length === 4) {
            r = parseInt(hex[1] + hex[1], 16);
            g = parseInt(hex[2] + hex[2], 16);
            b = parseInt(hex[3] + hex[3], 16);
        }
    } else if (hex.startsWith('rgb')) {
        const parts = hex.match(/\d+/g);
        if (parts) {
            r = parseInt(parts[0]);
            g = parseInt(parts[1]);
            b = parseInt(parts[2]);
        }
    }

    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    const isLight = yiq >= 170;
    const textColor = isLight ? '#111827' : '#FFFFFF';

    return {
        backgroundColor: hex,
        color: textColor,
        textShadow: textColor === '#FFFFFF' ? '0 1px 1px rgba(0,0,0,0.2)' : 'none',
        boxShadow: `0 1px 2px ${hex}30`,
        letterSpacing: '0.01em',
    };
}

// ─── Компонент подсказки ─────────────────────────────────
interface TooltipInfo {
    agent: string;
    agentEmoji: string;
    how: string;
    data: string;
}

function ColTooltip({ label, info, children }: { label: string; info: TooltipInfo; children: React.ReactNode }) {
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    const handleEnter = () => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPos({
                top: rect.bottom + window.scrollY + 6,
                left: Math.min(rect.left + window.scrollX, window.innerWidth - 280),
            });
        }
        setShow(true);
    };

    const agentColors: Record<string, string> = {
        'Семён': 'bg-blue-100 text-blue-800',
        'Максим': 'bg-purple-100 text-purple-800',
        'Игорь': 'bg-orange-100 text-orange-800',
    };

    return (
        <>
            <span ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)} className="cursor-help">
                {children}
            </span>
            {show && (
                <div
                    className="fixed z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs pointer-events-none"
                    style={{ top: pos.top, left: pos.left }}
                >
                    <div className="font-semibold text-gray-800 mb-2 leading-snug">{label}</div>
                    <div className="flex items-center gap-1.5 mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${agentColors[info.agent] || 'bg-gray-100 text-gray-600'}`}>
                            {info.agentEmoji} {info.agent}
                        </span>
                    </div>
                    <div className="space-y-1.5 text-gray-600 leading-snug">
                        <div>
                            <span className="font-medium text-gray-700">Как проверяется:</span>{' '}
                            {info.how}
                        </div>
                        <div>
                            <span className="font-medium text-gray-700">Данные:</span>{' '}
                            {info.data}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Окно объяснения (Popover) ───────────────────────────
function ExplainPopover({ label, info, onClose, pos }: { label: string, info: { result: boolean | null, reason: string | null }, onClose: () => void, pos: { top: number, left: number } }) {
    return (
        <div
            className="fixed z-[200] w-72 bg-white border border-gray-200 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in duration-200 origin-top"
            style={{ top: pos.top, left: pos.left }}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-black uppercase tracking-wider text-gray-400">Обоснование</div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="font-bold text-gray-800 text-sm mb-2 leading-tight">{label}</div>
            <div className="flex items-center gap-2 mb-3">
                {info.result === null ? (
                    <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-[10px] font-bold">НЕ ПРОВЕРЯЛОСЬ</span>
                ) : info.result ? (
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold">✅ ВЫПОЛНЕНО</span>
                ) : (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">❌ НЕ ВЫПОЛНЕНО</span>
                )}
            </div>
            <div className="text-xs text-gray-600 leading-relaxed bg-gray-50 p-2.5 rounded-xl border border-gray-100 italic">
                {info.reason || "Подробное обоснование не найдено. Возможно, это старая запись."}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-50 text-[9px] text-gray-300 text-center font-medium">Кликните в любом месте, чтобы закрыть</div>
        </div>
    );
}

// ─── Значок ячейки ───────────────────────────────────────
function C({ v, onClick }: { v: boolean | null, onClick?: (e: React.MouseEvent) => void }) {
    if (v === null || v === undefined) return <span className="text-gray-300 select-none">—</span>;
    return (
        <span
            onClick={onClick}
            className={`select-none cursor-pointer hover:scale-150 transition-transform inline-block ${onClick ? 'active:opacity-50' : ''}`}
        >
            {v ? <span className="text-green-600">✅</span> : <span className="text-red-500">❌</span>}
        </span>
    );
}

function Pct({ n }: { n: number | null }) {
    if (n === null) return <span className="text-gray-300">—</span>;
    const cls = n >= 80 ? 'bg-green-100 text-green-800' : n >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
    return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${cls}`}>{n}%</span>;
}

// ─── Определение колонок с подсказками ───────────────────
type ColDef = { key: string; label: string; type: 'bool' | 'text' | 'num'; tip: TooltipInfo };
type Group = { label: string; color: string; cellBg: string; cols: ColDef[] };

const COL_GROUPS: Group[] = [
    {
        label: 'Статус и время ожидания лида',
        color: 'bg-sky-50 text-sky-700',
        cellBg: 'bg-sky-50/40',
        cols: [
            {
                key: 'time_to_first_contact', label: 'Время до 1-го касания', type: 'text',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Разница между created_at заказа и started_at первого исходящего звонка', data: 'orders.created_at / raw_telphin_calls.started_at' }
            },
            {
                key: 'lead_in_work_lt_1_day', label: 'Лид в работе менее суток с даты поступления', type: 'bool',
                tip: { agent: 'Игорь', agentEmoji: '👮‍♂️', how: 'Проверяет: текущее время - created_at заказа < 24 часов', data: 'orders.created_at' }
            },
            {
                key: 'next_contact_not_overdue', label: 'Дата следующего контакта не просрочена/не сдвинута без причины', type: 'bool',
                tip: { agent: 'Игорь', agentEmoji: '👮‍♂️', how: 'next_contact_date >= сегодня', data: 'raw_payload.customFields.next_contact_date' }
            },
            {
                key: 'lead_in_work_lt_1_day_after_tz', label: 'Лид в работе менее суток с даты получения ТЗ', type: 'bool',
                tip: { agent: 'Игорь', agentEmoji: '👮‍♂️', how: 'Проверяет: updated_at после ТЗ < 24 часов', data: 'orders.updated_at' }
            },
            {
                key: 'deal_in_status_lt_5_days', label: 'Сделка находится в одном статусе менее 5 дней', type: 'bool',
                tip: { agent: 'Игорь', agentEmoji: '👮‍♂️', how: 'Сейчас - orders.updated_at < 5 дней', data: 'orders.updated_at' }
            },
        ]
    },
    {
        label: 'Заполнение полей и ведение',
        color: 'bg-purple-50 text-purple-700',
        cellBg: 'bg-purple-50/40',
        cols: [
            {
                key: 'tz_received', label: 'ТЗ от клиента получено (ширина, длина, высота, t°, тип нагрева)', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Проверяет наличие полей размеров/температуры в customFields заказа', data: 'raw_payload.customFields (tz, width, height, temperature)' }
            },
            {
                key: 'field_buyer_filled', label: 'Заполнение поля «Покупатель» — данные организации', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Проверяет поля company.name, contact.name или customer.* (firstName/lastName/companyName) в данных заказа', data: 'raw_payload.company / raw_payload.contact / raw_payload.customer' }
            },
            {
                key: 'field_product_category', label: 'Заполнено поле «Категория товара»', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Ищем теги товара в customFields (tovarnaya_kategoriya, product_category, category или любой ключ с "катег"/"kategori")', data: 'raw_payload.customFields' }
            },
            {
                key: 'field_contact_data', label: 'Внесены «Контактные данные клиента»', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Проверяет phone / email / contact.phones в заказе', data: 'raw_payload.phone / email / contact.phones' }
            },
            {
                key: 'relevant_number_found', label: 'Релевантный номер (поиск в интернете если не дозвониться)', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Есть ли исходящие звонки по заказу', data: 'raw_telphin_calls (direction=outgoing) через call_order_matches' }
            },
            {
                key: 'field_expected_amount', label: 'Указана ожидаемая сумма сделки', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'customFields.expected_amount > 0 или totalSumm > 0', data: 'raw_payload.customFields.expected_amount / totalSumm' }
            },
            {
                key: 'field_purchase_form', label: 'Указана «Форма закупки»', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Наличие customFields.forma_zakupki / purchase_form', data: 'raw_payload.customFields.forma_zakupki' }
            },
            {
                key: 'field_sphere_correct', label: 'Указана и указана верно «Сфера деятельности»', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'customFields со сферой деятельности заполнен', data: 'raw_payload.customFields.sfera_deyatelnosti / sphere_of_activity' }
            },
            {
                key: 'mandatory_comments', label: 'Обязательные комментарии МОПов в сделке', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Есть хоть одно событие-комментарий по заказу', data: 'raw_order_events (event_type ILIKE %comment%)' }
            },
            {
                key: 'email_sent_no_answer', label: 'В случае отсутствия ответа — направление писем клиенту', type: 'bool',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Если есть звонки без ответа (duration=0) — проверяет наличие email события', data: 'raw_telphin_calls.duration_sec=0 → raw_order_events (email)' }
            },
        ]
    },
    {
        label: 'Оценка разговоров',
        color: 'bg-blue-50 text-blue-700',
        cellBg: 'bg-blue-50/40',
        cols: [
            {
                key: 'calls_status', label: 'Статус звонков', type: 'text',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: '"Дозвон есть" / "Попытки без ответа" / "Нет звонков"', data: 'raw_telphin_calls (duration_sec, direction) через call_order_matches' }
            },
            {
                key: 'calls_total_duration', label: 'Общая длительность всех разговоров', type: 'text',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Сумма duration_sec всех звонков по заказу', data: 'raw_telphin_calls.duration_sec через call_order_matches' }
            },
            {
                key: 'calls_attempts_count', label: 'Совершено звонков/попыток дозвона', type: 'num',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Количество исходящих звонков (direction=outgoing)', data: 'raw_telphin_calls (direction=outgoing) через call_order_matches' }
            },
            {
                key: 'calls_evaluated_count', label: 'Количество оцененных звонков в сделке', type: 'num',
                tip: { agent: 'Семён', agentEmoji: '🎧', how: 'Звонки у которых есть расшифровка (transcript != null)', data: 'raw_telphin_calls.transcript через call_order_matches' }
            },
        ]
    },
    {
        label: 'Установление контакта',
        color: 'bg-emerald-50 text-emerald-700',
        cellBg: 'bg-emerald-50/40',
        cols: [
            {
                key: 'script_greeting', label: 'Приветствие клиента, представление сотрудника и компании', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT анализирует транскрипцию: есть ли приветствие + представление по имени + компания', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_call_purpose', label: 'Привязка к предыдущему шагу, обозначение цели звонка', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT проверяет: менеджер напомнил контекст прошлого диалога и назвал цель звонка', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
        ]
    },
    {
        label: 'Выявление потребностей',
        color: 'bg-teal-50 text-teal-700',
        cellBg: 'bg-teal-50/40',
        cols: [
            {
                key: 'script_company_info', label: 'Чем занимается организация, Бюджет, НДС, Кол-во сотрудников', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: выявлены ли ключевые данные о компании клиента', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_deadlines', label: 'Сроки, когда оборудование должно уже стоять', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: уточнены ли сроки установки оборудования', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_tz_confirmed', label: 'Убедиться, что ТЗ от клиента получено (параметры камеры)', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: подтверждено получение ТЗ с параметрами (ш×д×в, t°, нагрев)', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
        ]
    },
    {
        label: 'Работа с возражениями',
        color: 'bg-orange-50 text-orange-700',
        cellBg: 'bg-orange-50/40',
        cols: [
            {
                key: 'script_objection_general', label: 'Общая работа с возражениями', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: присутствует ли отработка возражений клиента', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_objection_delays', label: 'Если клиент тянит сроки — выяснить конкурентов', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: при затягивании — выяснены ли конкуренты и причина', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_offer_best_tech', label: '1. Наше предложение лучшее по тех. характеристикам?', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: аргументированы ли тех. преимущества предложения', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_offer_best_terms', label: '2. Наше предложение лучшее по срокам?', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: аргументированы ли преимущества по срокам поставки', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_offer_best_price', label: '3. Наше предложение лучшее по цене?', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: аргументированы ли ценовые преимущества', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
        ]
    },
    {
        label: 'В конце диалога',
        color: 'bg-pink-50 text-pink-700',
        cellBg: 'bg-pink-50/40',
        cols: [
            {
                key: 'script_cross_sell', label: 'Кросс-продажа (информирование об иных товарах)', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: упомянуто ли иное оборудование / сопутствующие услуги', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_next_step_agreed', label: 'Договорённость о следующем шаге / получение отзыва', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: зафиксирован ли следующий шаг или запрос отзыва', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
        ]
    },
    {
        label: 'Ведение диалога',
        color: 'bg-violet-50 text-violet-700',
        cellBg: 'bg-violet-50/40',
        cols: [
            {
                key: 'script_dialogue_management', label: 'Управление разговором (инициатива)', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: держал ли менеджер инициативу и вёл ли разговор по структуре', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_confident_speech', label: 'Уверенная, спокойная речь. Грамотность.', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: оценивает стиль речи: паузы, слова-паразиты, уверенность', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
        ]
    },
];

// Подсказки для итоговых колонок
const SCORE_COLS: Array<{ key: string; label: string; tip: TooltipInfo }> = [
    {
        key: 'deal_score', label: 'Оценка сделки',
        tip: { agent: 'Максим', agentEmoji: '🤓', how: 'Кол-во выполненных пунктов из группы «Заполнение полей и ведение»', data: 'Агрегация булевых полей field_* + lead_* + deal_*' }
    },
    {
        key: 'deal_score_pct', label: '% правил ведения',
        tip: { agent: 'Максим', agentEmoji: '🤓', how: '(Выполненные пункты ÷ Всего пунктов) × 100', data: 'Агрегация по полям fill_* (13 критериев)' }
    },
    {
        key: 'script_score', label: 'Оценка скрипта',
        tip: { agent: 'Максим', agentEmoji: '🤓', how: 'Кол-во выполненных пунктов из 14 пунктов скрипта', data: 'GPT-оценка по script_* полям' }
    },
    {
        key: 'script_score_pct', label: '% скрипта',
        tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT возвращает итоговый % выполнения скрипта (0-100)', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
    },
];

export default function OKKPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-gray-400">Загрузка...</div>}>
            <OKKContent />
        </Suspense>
    );
}

function OKKContent() {
    const searchParams = useSearchParams();
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';

    const [scores, setScores] = useState<OrderScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<string | null>(null);
    const [filterManager, setFilterManager] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [sortBy, setSortBy] = useState<string>('order_id');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [runLimit, setRunLimit] = useState(50);
    const [targetOrderId, setTargetOrderId] = useState('');
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [activeExplain, setActiveExplain] = useState<{ label: string, info: any, pos: { top: number, left: number } } | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown and popover on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setStatusDropdownOpen(false);
            }
            setActiveExplain(null);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams();
            if (from) query.set('from', from);
            if (to) query.set('to', to);

            const res = await fetch(`/api/okk/scores?${query.toString()}`);
            const json = await res.json();
            setScores(json.scores || []);
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { load(); }, [load, from, to]);

    const runAll = async () => {
        setRunning(true);
        setRunResult(null);
        try {
            const query = new URLSearchParams();
            if (runLimit) query.append('limit', runLimit.toString());
            if (targetOrderId) query.append('orderId', targetOrderId);

            const res = await fetch(`/api/okk/run-all?${query.toString()}`);
            const json = await res.json();
            setRunResult(`✅ Обработано: ${json.processed}, ошибок: ${json.errors}`);
            setTimeout(load, 1500);
        } catch {
            setRunResult('❌ Ошибка запуска');
        } finally {
            setRunning(false);
        }
    };

    const handleSingleRun = async (orderId: number) => {
        setRunning(true);
        setRunResult(`Перепроверка заказа #${orderId}...`);
        try {
            await fetch(`/api/okk/run-all?orderId=${orderId}`);
            setRunResult(`✅ Заказ #${orderId} обновлен`);
            load();
        } catch (e) {
            setRunResult(`❌ Ошибка #${orderId}`);
        }
        setRunning(false);
    };

    const handleBatchRun = async () => {
        if (selectedIds.size === 0) return;
        setRunning(true);
        const ids = Array.from(selectedIds);
        let done = 0;
        let errs = 0;

        for (const id of ids) {
            setRunResult(`Пакетная проверка: ${done + errs + 1}/${ids.length} (ID #${id})`);
            try {
                await fetch(`/api/okk/run-all?orderId=${id}`);
                done++;
            } catch (e) {
                errs++;
            }
        }
        setRunResult(`✅ Пакетная проверка завершена. Успешно: ${done}, Ошибок: ${errs}`);
        setSelectedIds(new Set());
        load();
        setRunning(false);
    };

    const toggleSelect = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filtered.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filtered.map(s => s.order_id)));
        }
    };

    const filtered = scores
        .filter(s => {
            if (filterManager && !(s.manager_name || s.mop_name || '')?.toLowerCase().includes(filterManager.toLowerCase())) return false;
            if (filterStatus && s.order_status !== filterStatus) return false;
            return true;
        })
        .sort((a, b) => {
            const va = (a as any)[sortBy] ?? '';
            const vb = (b as any)[sortBy] ?? '';
            return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

    // Средний балл по всему ОП (все заказы с оценкой)
    const scoredOrders = scores.filter(s => s.deal_score_pct !== null && s.deal_score_pct !== undefined);
    const avgScore = scoredOrders.length > 0
        ? Math.round(scoredOrders.reduce((sum, s) => sum + (s.deal_score_pct ?? 0), 0) / scoredOrders.length)
        : null;
    const avgScoreColor = avgScore === null ? '#94a3b8' : avgScore >= 75 ? '#16a34a' : avgScore >= 50 ? '#d97706' : '#dc2626';


    const statusMap = new Map<string, { label: string, color?: string }>();
    scores.forEach(s => {
        if (s.order_status && !statusMap.has(s.order_status)) {
            statusMap.set(s.order_status, {
                label: s.status_label || s.order_status,
                color: s.status_color
            });
        }
    });
    const availableStatuses = Array.from(statusMap.entries()).map(([code, meta]) => ({
        code,
        ...meta
    })).sort((a, b) => a.label.localeCompare(b.label));

    const handleSort = (key: string) => {
        if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(key); setSortDir('desc'); }
    };

    // Рендер заголовка колонки с переносом по словам и тултипом
    const ColTh = ({ col }: { col: ColDef | typeof SCORE_COLS[0] }) => (
        <th
            className={`px-2 py-2 text-center text-[11px] font-normal text-gray-600 border-r border-gray-100 cursor-pointer hover:bg-gray-100 min-w-[72px] max-w-[100px] align-top ${sortBy === col.key ? 'text-blue-600 font-semibold bg-blue-50' : ''}`}
            onClick={() => handleSort(col.key)}
        >
            <ColTooltip label={col.label} info={col.tip}>
                <span className="block leading-tight whitespace-normal break-words text-center">
                    {col.label}
                    {sortBy === col.key && <span className="ml-0.5">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </span>
            </ColTooltip>
        </th>
    );

    const renderCell = (s: OrderScore, col: ColDef, cellBg: string) => {
        const val = (s as any)[col.key];
        const breakdown = s.score_breakdown?.[col.key];

        const handleCellClick = (e: React.MouseEvent) => {
            if (!breakdown) return;
            e.stopPropagation();

            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            let top = rect.bottom + window.scrollY + 10;
            let left = rect.left + window.scrollX - 100;

            if (left < 10) left = 10;
            if (left + 300 > window.innerWidth) left = window.innerWidth - 310;
            if (top + 200 > window.innerHeight + window.scrollY) top = rect.top + window.scrollY - 200;

            setActiveExplain({
                label: col.label,
                info: breakdown,
                pos: { top, left }
            });
        };

        let content;
        if (col.type === 'bool') content = <C v={val} onClick={breakdown ? handleCellClick : undefined} />;
        else if (col.type === 'num') content = <span className="text-gray-600 text-xs">{val ?? '—'}</span>;
        else content = <span className="text-gray-600 text-xs" title={val}>{val ?? '—'}</span>;

        return <td key={col.key} className={`px-1 py-1.5 text-center border-r border-gray-100 ${cellBg}`}>{content}</td>;
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0 shadow-sm">
                <div className="flex items-center gap-3">
                    <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm p-2 bg-gray-50 rounded-lg transition-colors">←</Link>
                    <div className="flex flex-col">
                        <h1 className="text-base font-bold text-gray-900 leading-tight">ОКК — Контроль качества</h1>
                        <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">{filtered.length} заказов в списке</span>
                    </div>
                </div>

                {/* Средний балл по ОП */}
                <div className="flex flex-col items-center gap-0.5">
                    <div style={{ color: avgScoreColor, fontVariantNumeric: 'tabular-nums' }} className="text-5xl font-black leading-none tracking-tight">
                        {avgScore !== null ? `${avgScore}%` : '—'}
                    </div>
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Средний % по ОП</span>
                    {scoredOrders.length > 0 && (
                        <span className="text-[9px] text-gray-300">{scoredOrders.length} оценённых</span>
                    )}
                </div>

                <div className="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                    <div className="flex flex-col px-2">
                        <span className="text-[9px] text-gray-400 font-black uppercase tracking-tighter">Заказ №</span>
                        <input
                            type="text"
                            placeholder="Все"
                            value={targetOrderId}
                            onChange={(e) => setTargetOrderId(e.target.value)}
                            className="bg-transparent border-none text-xs font-bold w-16 focus:ring-0 p-0 h-4"
                        />
                    </div>
                    <div className="flex flex-col border-l border-gray-200 px-2 leading-none">
                        <span className="text-[9px] text-gray-400 font-black uppercase tracking-tighter">Лимит</span>
                        <input
                            type="number"
                            value={runLimit}
                            onChange={(e) => setRunLimit(parseInt(e.target.value) || 0)}
                            className="bg-transparent border-none text-xs font-bold w-10 focus:ring-0 p-0 h-4"
                        />
                    </div>
                    <button
                        onClick={runAll}
                        disabled={running}
                        className={`${running ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100'} px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2`}
                    >
                        {running ? (
                            <div className="w-3 h-3 border-2 border-gray-400 border-t-blue-500 animate-spin rounded-full" />
                        ) : '▶'}
                        {targetOrderId ? 'ПРОВЕРИТЬ' : 'ЗАПУСТИТЬ'}
                    </button>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={handleBatchRun}
                            disabled={running}
                            className={`${running ? 'bg-gray-100 text-gray-400' : 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-100'} px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 animate-in slide-in-from-right-2`}
                        >
                            ♻️ ПЕРЕПРОВЕРИТЬ ВЫБРАННЫЕ ({selectedIds.size})
                        </button>
                    )}
                </div>
            </div>

            {runResult && (
                <div className="mx-4 mt-2 bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-1.5 rounded-lg flex-shrink-0">{runResult}</div>
            )}

            {/* Filters */}
            <div className="px-4 py-2 flex gap-2 bg-white border-b border-gray-100 flex-shrink-0">
                <input type="text" placeholder="🔍 Менеджер" value={filterManager} onChange={e => setFilterManager(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {/* Custom Status Dropdown */}
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 min-w-[160px] flex items-center justify-between hover:bg-gray-50 transition-colors shadow-sm active:scale-95 duration-75"
                    >
                        {(() => {
                            const active = availableStatuses.find(s => s.code === filterStatus);
                            if (!active) return <span className="text-gray-500 text-sm font-medium">✨ Все статусы</span>;
                            return (
                                <span
                                    className="text-[10px] px-2 py-0.5 rounded-full font-black shadow-sm"
                                    style={getBadgeStyle(active.color)}
                                >
                                    {active.label}
                                </span>
                            );
                        })()}
                        <span className={`text-[10px] text-gray-400 ml-2 transition-transform duration-200 ${statusDropdownOpen ? 'rotate-180' : ''}`}>▼</span>
                    </button>

                    {statusDropdownOpen && (
                        <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-2xl z-[100] p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in duration-150 origin-top">
                            <button
                                onClick={() => { setFilterStatus(''); setStatusDropdownOpen(false); }}
                                className="w-full text-left px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-between"
                            >
                                Все статусы
                                {filterStatus === '' && <span className="text-blue-500 font-bold">✓</span>}
                            </button>
                            <div className="h-px bg-gray-100 my-1 mx-2" />
                            {availableStatuses.map(s => (
                                <button
                                    key={s.code}
                                    onClick={() => { setFilterStatus(s.code); setStatusDropdownOpen(false); }}
                                    className="w-full text-left px-2 py-1 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-between group"
                                >
                                    <span
                                        className="text-[10px] px-2 py-0.5 rounded-full font-black shadow-sm group-hover:scale-105 transition-transform"
                                        style={getBadgeStyle(s.color)}
                                    >
                                        {s.label}
                                    </span>
                                    {filterStatus === s.code && <span className="text-blue-500 text-xs font-bold mr-1">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {(filterManager || filterStatus) && (
                    <button onClick={() => { setFilterManager(''); setFilterStatus(''); }} className="text-xs text-gray-400 hover:text-gray-600">✕ Сбросить</button>
                )}
                <span className="ml-auto text-xs text-gray-400 self-center">💡 Наведите на заголовок колонки для подсказки</span>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="text-xs border-collapse min-w-max">
                    <thead className="sticky top-0 z-10">
                        {/* Row 1: groups */}
                        <tr className="bg-gray-100 border-b border-gray-200 text-gray-700">
                            <th rowSpan={2} className="px-2 py-2 text-left sticky left-0 bg-gray-100 z-20 border-r border-gray-200 font-semibold min-w-[30px]">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                            </th>
                            <th rowSpan={2} className="px-2 py-2 text-left sticky left-[40px] bg-gray-100 z-20 border-r border-gray-200 font-semibold min-w-[60px]">Заказ</th>
                            <th rowSpan={2} className="px-2 py-2 text-left bg-gray-100 border-r border-gray-200 font-semibold text-gray-700 min-w-[100px]">МОП</th>
                            <th rowSpan={2} className="px-2 py-2 text-left bg-gray-100 border-r border-gray-200 font-semibold text-gray-700 min-w-[80px]">Статус лида</th>
                            {COL_GROUPS.map(g => (
                                <th key={g.label} colSpan={g.cols.length}
                                    className={`px-2 py-1.5 text-center font-semibold text-xs border-r border-gray-200 ${g.color}`}>
                                    {g.label}
                                </th>
                            ))}
                            <th colSpan={4} className="px-2 py-1.5 text-center font-semibold text-xs bg-gray-200 text-gray-700 border-r border-gray-200">
                                Оценка выполнения
                            </th>
                        </tr>
                        {/* Row 2: column headers with wrap + tooltip */}
                        <tr className="bg-gray-50 border-b border-gray-200">
                            {COL_GROUPS.map(g => g.cols.map(col => <ColTh key={col.key} col={col} />))}
                            {SCORE_COLS.map(col => <ColTh key={col.key} col={col as any} />)}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={100} className="text-center py-12 text-gray-400">Загрузка...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={100} className="text-center py-12 text-gray-400">
                                    Нет данных.{' '}
                                    <button onClick={runAll} className="text-blue-600 underline">Запустить прогон</button>
                                </td>
                            </tr>
                        ) : filtered.map((s, i) => (
                            <tr key={s.order_id} className={`border-b border-gray-100 hover:bg-yellow-50/30 ${selectedIds.has(s.order_id) ? 'bg-blue-50/50' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}`}>
                                <td className="px-2 py-1.5 sticky left-0 bg-white border-r border-gray-200 z-10 text-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(s.order_id)}
                                        onChange={() => toggleSelect(s.order_id)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                </td>
                                <td className="px-2 py-1.5 sticky left-[40px] bg-white font-mono border-r border-gray-200 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleSingleRun(s.order_id)}
                                            disabled={running}
                                            title="Перепроверить только этот заказ"
                                            className="hover:scale-125 transition-transform disabled:opacity-30"
                                        >
                                            ↩️
                                        </button>
                                        <a href={`https://zmktlt.retailcrm.ru/orders/${s.order_id}/edit`} target="_blank" rel="noreferrer"
                                            className="text-blue-600 hover:underline text-xs font-bold font-sans">#{s.order_id}</a>
                                    </div>
                                </td>
                                <td className="px-2 py-1.5 border-r border-gray-100 whitespace-nowrap font-medium text-gray-800">{s.manager_name || '—'}</td>
                                <td className="px-2 py-1.5 border-r border-gray-100">
                                    <span
                                        className="text-[10px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap"
                                        style={getBadgeStyle(s.status_color)}
                                        title={s.order_status || ''}
                                    >
                                        {s.status_label || s.order_status || '—'}
                                    </span>
                                </td>
                                {COL_GROUPS.map(g => g.cols.map(col => renderCell(s, col, g.cellBg)))}
                                {/* Оценка выполнения */}
                                <td className="px-2 py-1.5 text-center border-r border-gray-100 bg-gray-50">
                                    <span className="text-xs text-gray-600">{s.deal_score ?? '—'}</span>
                                </td>
                                <td className="px-2 py-1.5 text-center border-r border-gray-100 bg-gray-50">
                                    <Pct n={s.deal_score_pct} />
                                </td>
                                <td className="px-2 py-1.5 text-center border-r border-gray-100 bg-gray-50">
                                    <span className="text-xs text-gray-600">{s.script_score ?? '—'}</span>
                                </td>
                                <td className="px-2 py-1.5 text-center bg-gray-50">
                                    <Pct n={s.script_score_pct} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {activeExplain && (
                <ExplainPopover
                    label={activeExplain.label}
                    info={activeExplain.info}
                    onClose={() => setActiveExplain(null)}
                    pos={activeExplain.pos}
                />
            )}
        </div>
    );
}
