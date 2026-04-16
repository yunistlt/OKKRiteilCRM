// ОТВЕТСТВЕННЫЙ: МАКСИМ (Аудитор) — Рабочее место аудитора (Дашборд ОКК).
'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import { MultiSelect } from '../components/MultiSelect';
import CallInitiator from '@/components/calls/CallInitiator';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import OKKConsultantPanel from '@/components/OKKConsultantPanel';
import { useAuth } from '@/components/auth/AuthProvider';
import { getRoleCapability } from '@/lib/access-control';
import { isVisibleBreakdownKey } from '@/lib/okk-consultant';
import { formatQualityCriterionLabel } from '@/lib/quality-labels';

interface User {
    username: string;
    role: string;
}

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
    score_breakdown: Record<string, {
        result: boolean | null;
        reason: string | null;
        reason_human?: string | null;
        rule_id?: string | null;
        source_refs?: string[];
        source_values?: Record<string, any> | null;
        calculation_steps?: string[];
        confidence?: number | null;
        missing_data?: string[];
        recommended_fix?: string | null;
        penalty_journal?: Array<Record<string, any>>;
    }> | null;
    manager_name?: string;
    status_label?: string;
    status_color?: string;
    total_sum?: number;
    violations?: any[];
    reactivation?: {
        status: string;
        sent_at: string | null;
        opened_at: string | null;
        replied_at: string | null;
        intent_status: string | null;
        generated_email: string | null;
        client_reply: string | null;
    } | null;
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
        <>
            {/* Overlay to catch clicks outside */}
            <div className="fixed inset-0 z-[190] bg-black/5" onClick={onClose} />

            <div
                className="fixed z-[200] w-72 bg-white border border-gray-200 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in duration-200 origin-top"
                style={{ top: pos.top, left: pos.left }}
                onClick={(e) => e.stopPropagation()}
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
                <div className="mt-3 pt-3 border-t border-gray-50 text-[9px] text-gray-400 text-center font-medium">Кликните за пределами окна, чтобы закрыть</div>
            </div>
        </>
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
    return <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-bold leading-none ${cls}`}>{n}%</span>;
}

// ─── Определение колонок с подсказками ───────────────────
type ColDef = { key: string; label: string; type: 'bool' | 'text' | 'num'; tip: TooltipInfo };
type Group = { label: string; color: string; cellBg: string; cols: ColDef[] };

// Ключи, которые входят в расчёт deal_score_pct на бэкенде
const DEAL_CHECK_KEYS = [
    'tz_received', 'field_buyer_filled', 'field_product_category', 'field_contact_data',
    'relevant_number_found', 'field_expected_amount', 'field_purchase_form', 'field_sphere_correct',
    'mandatory_comments', 'email_sent_no_answer', 'lead_in_work_lt_1_day', 'next_contact_not_overdue',
    'deal_in_status_lt_5_days',
];

// Ключи скрипт-колонок для расчёта script_score_pct
const SCRIPT_CHECK_KEYS = [
    'script_greeting', 'script_call_purpose', 'script_company_info', 'script_lpr_identified',
    'script_budget_confirmed', 'script_urgency_identified', 'script_deadlines', 'script_tz_confirmed',
    'script_objection_general', 'script_objection_delays', 'script_offer_best_tech',
    'script_offer_best_terms', 'script_offer_best_price', 'script_cross_sell',
    'script_next_step_agreed', 'script_dialogue_management', 'script_confident_speech',
];

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
        label: 'Выявление потребностей и БА',
        color: 'bg-teal-50 text-teal-700',
        cellBg: 'bg-teal-50/40',
        cols: [
            {
                key: 'script_company_info', label: 'Чем занимается организация', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: выявлена ли сфера деятельности клиента', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_lpr_identified', label: 'Выявление ЛПР', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT/Анна: выявлено ли лицо, принимающее решение', data: 'Anna.lpr / GPT' }
            },
            {
                key: 'script_budget_confirmed', label: 'Подтверждение бюджета', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT/Анна: обсуждался ли финансовый вопрос', data: 'Anna.budget / GPT' }
            },
            {
                key: 'script_urgency_identified', label: 'Срочность покупки', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT/Анна: выяснено ли "когда нужно" оборудование', data: 'Anna.urgency / GPT' }
            },
            {
                key: 'script_deadlines', label: 'Сроки поставки', type: 'bool',
                tip: { agent: 'Максим', agentEmoji: '🤓', how: 'GPT: уточнены ли конкретные сроки установки/готовности', data: 'raw_telphin_calls.transcript → GPT-4o-mini' }
            },
            {
                key: 'script_tz_confirmed', label: 'Параметры ТЗ (камера)', type: 'bool',
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
    {
        label: 'Реактивация (Виктория)',
        color: 'bg-emerald-50 text-emerald-700',
        cellBg: 'bg-emerald-50/40',
        cols: [
            {
                key: 'reactivation_status', label: 'Статус рассылки', type: 'text' as any,
                tip: { agent: 'Виктория', agentEmoji: '👩‍💼', how: 'Отслеживает: отправлено (✉️), прочитано (👁️), ответил (💬)', data: 'ai_outreach_logs (status, opened_at)' }
            }
        ]
    }
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

// ─── Панель настройки колонок ──────────────────────────────
const LOCALSTORAGE_KEY = 'okk_hidden_columns';

function loadHiddenColumns(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        const saved = localStorage.getItem(LOCALSTORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return new Set(parsed);
        }
    } catch {}
    return new Set();
}

function saveHiddenColumns(hidden: Set<string>) {
    try {
        localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(Array.from(hidden)));
    } catch {}
}

/** Пересчитывает deal_score_pct с учётом скрытых колонок */
function recalcDealScorePct(order: OrderScore, hiddenCols: Set<string>): number | null {
    const activeKeys = DEAL_CHECK_KEYS.filter(k => !hiddenCols.has(k));
    if (activeKeys.length === 0) return null;
    const checks = activeKeys
        .map(k => (order as any)[k] ?? order.score_breakdown?.[k]?.result ?? null)
        .filter(v => v !== null && v !== undefined);
    if (checks.length === 0) return null;
    const passed = checks.filter(v => !!v).length;
    return Math.round((passed / checks.length) * 100);
}

/** Пересчитывает script_score_pct с учётом скрытых колонок */
function recalcScriptScorePct(order: OrderScore, hiddenCols: Set<string>): number | null {
    const activeKeys = SCRIPT_CHECK_KEYS.filter(k => !hiddenCols.has(k));
    if (activeKeys.length === 0) return null;
    const checks = activeKeys
        .map(k => {
            const bd = order.score_breakdown?.[k];
            if (bd && typeof bd === 'object' && bd.result !== undefined) return bd.result;
            return (order as any)[k] ?? null;
        })
        .filter(v => v !== null && v !== undefined);
    if (checks.length === 0) return null;
    const passed = checks.filter(v => !!v).length;
    return Math.round((passed / checks.length) * 100);
}

function ColumnSettingsPanel({ hiddenColumns, onToggle, onClose }: {
    hiddenColumns: Set<string>;
    onToggle: (key: string) => void;
    onClose: () => void;
}) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const allCols = COL_GROUPS.flatMap(g => g.cols);
    const totalVisible = allCols.filter(c => !hiddenColumns.has(c.key)).length;

    return (
        <div ref={panelRef} className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl w-[420px] max-h-[70vh] overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-200 origin-top-left">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50">
                <div>
                    <h3 className="text-sm font-black text-gray-800">Настройка колонок</h3>
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">Показано {totalVisible} из {allCols.length} колонок</p>
                </div>
                <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shadow-sm border border-gray-100">✕</button>
            </div>
            <div className="overflow-y-auto max-h-[calc(70vh-120px)] p-2">
                {COL_GROUPS.map(group => {
                    const groupVisible = group.cols.filter(c => !hiddenColumns.has(c.key)).length;
                    const allChecked = groupVisible === group.cols.length;
                    const noneChecked = groupVisible === 0;
                    return (
                        <div key={group.label} className="mb-1">
                            <button
                                onClick={() => {
                                    // Toggle всей группы
                                    if (allChecked) {
                                        group.cols.forEach(c => { if (!hiddenColumns.has(c.key)) onToggle(c.key); });
                                    } else {
                                        group.cols.forEach(c => { if (hiddenColumns.has(c.key)) onToggle(c.key); });
                                    }
                                }}
                                className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 transition-colors hover:bg-gray-50 ${group.color}`}
                            >
                                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all text-[10px] font-black ${
                                    allChecked ? 'bg-blue-600 border-blue-600 text-white' :
                                    noneChecked ? 'bg-white border-gray-300' :
                                    'bg-blue-100 border-blue-400 text-blue-600'
                                }`}>
                                    {allChecked ? '✓' : noneChecked ? '' : '−'}
                                </span>
                                <span className="text-xs font-bold flex-1">{group.label}</span>
                                <span className="text-[10px] font-bold text-gray-400">{groupVisible}/{group.cols.length}</span>
                            </button>
                            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-0.5 mt-0.5 mb-1">
                                {group.cols.map(col => {
                                    const visible = !hiddenColumns.has(col.key);
                                    const isDealKey = DEAL_CHECK_KEYS.includes(col.key);
                                    const isScriptKey = SCRIPT_CHECK_KEYS.includes(col.key);
                                    return (
                                        <button
                                            key={col.key}
                                            onClick={() => onToggle(col.key)}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all text-xs group ${
                                                visible ? 'hover:bg-blue-50/50 text-gray-700' : 'hover:bg-gray-50 text-gray-400'
                                            }`}
                                        >
                                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all text-[9px] font-black ${
                                                visible ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-white border-gray-300 group-hover:border-blue-300'
                                            }`}>
                                                {visible && '✓'}
                                            </span>
                                            <span className={`flex-1 leading-snug ${visible ? 'font-medium' : 'font-normal line-through decoration-gray-300'}`}>
                                                {col.label}
                                            </span>
                                            {(isDealKey || isScriptKey) && (
                                                <span className={`text-[8px] font-black px-1 py-0.5 rounded ${isDealKey ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600'}`}>
                                                    {isDealKey ? 'СДЕЛКА' : 'СКРИПТ'}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <span className="text-[10px] text-gray-400 font-medium italic">Скрытые колонки не учитываются в рейтинге</span>
                <button
                    onClick={() => {
                        // Показать все
                        hiddenColumns.forEach(k => onToggle(k));
                    }}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded hover:bg-blue-50"
                >
                    Показать все
                </button>
            </div>
        </div>
    );
}

// ─── Таймер обратного отсчета до Cron проверки ──────────
function CountdownTimer() {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        const calculate = () => {
            const now = new Date();
            const mins = now.getMinutes();
            const secs = now.getSeconds();

            // Крон запускается каждые 30 минут (00 и 30)
            let nextMins = mins < 30 ? 30 : 60;
            let diffMins = nextMins - mins - 1;
            let diffSecs = 60 - secs;

            if (diffSecs === 60) {
                diffSecs = 0;
                diffMins += 1;
            }

            setTimeLeft(`${String(diffMins).padStart(2, '0')}:${String(diffSecs).padStart(2, '0')}`);
        };

        calculate();
        const timer = setInterval(calculate, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="flex flex-col items-center px-2 border-l border-gray-100">
            <span className="text-[10px] font-black text-blue-500 tabular-nums leading-none tracking-tighter">{timeLeft}</span>
            <span className="text-[7px] text-gray-400 font-bold uppercase tracking-tighter whitespace-nowrap">до проверки</span>
        </div>
    );
}

export default function OKKPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-gray-400">Загрузка...</div>}>
            <OKKContent />
        </Suspense>
    );
}

function OKKContent() {
    const { user, roleCapabilities } = useAuth();
    const currentCapability = useMemo(() => getRoleCapability((user?.role as AppRole | undefined) || null, roleCapabilities), [roleCapabilities, user?.role]);
    const searchParams = useSearchParams();
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';

    const [scores, setScores] = useState<OrderScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<string | null>(null);
    const [filterManager, setFilterManager] = useState<string[]>([]);
    const [filterStatus, setFilterStatus] = useState<string[]>([]);
    const [sortBy, setSortBy] = useState<string>('order_id');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [runLimit, setRunLimit] = useState(50);
    const [targetOrderId, setTargetOrderId] = useState('');
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [activeExplain, setActiveExplain] = useState<{ label: string, info: any, pos: { top: number, left: number } } | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalCount: 0, totalPages: 0 });
    const [averages, setAverages] = useState({ totalAvgScore: 0, filteredAvgScore: 0 });
    const [selectedCallOrder, setSelectedCallOrder] = useState<OrderScore | null>(null);
    const [selectedViolationsOrder, setSelectedViolationsOrder] = useState<OrderScore | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [consultantOrderId, setConsultantOrderId] = useState<number | null>(null);
    const [activeManagers, setActiveManagers] = useState<{ id: number, name: string }[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => loadHiddenColumns());
    const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);

    const hasHiddenColumns = hiddenColumns.size > 0;

    const toggleColumnVisibility = useCallback((key: string) => {
        setHiddenColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            saveHiddenColumns(next);
            return next;
        });
    }, []);

    // Отфильтрованные группы колонок (только видимые)
    const visibleColGroups = useMemo(() => {
        return COL_GROUPS.map(g => ({
            ...g,
            cols: g.cols.filter(c => !hiddenColumns.has(c.key))
        })).filter(g => g.cols.length > 0);
    }, [hiddenColumns]);

    // Fetch active managers for dropdown
    useEffect(() => {
        fetch('/api/okk/managers')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setActiveManagers(data);
            })
            .catch(console.error);
    }, []);

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
            query.set('page', pagination.page.toString());
            query.set('pageSize', pagination.pageSize.toString());
            if (filterManager.length > 0) query.set('manager', filterManager.join(','));
            if (filterStatus.length > 0) query.set('status', filterStatus.join(','));

            const res = await fetch(`/api/okk/scores?${query.toString()}`);
            const json = await res.json();
            setScores(Array.isArray(json.scores) ? json.scores : []);
            if (json.pagination) {
                setPagination(prev => ({ ...prev, ...json.pagination }));
            }
            if (json.averages) {
                setAverages(json.averages);
            }
        } finally {
            setLoading(false);
        }
    }, [from, to, pagination.page, pagination.pageSize, filterManager, filterStatus]);

    useEffect(() => { load(); }, [load, from, to, pagination.page, pagination.pageSize]);

    // Reset page to 1 when filters change
    useEffect(() => {
        setPagination(prev => ({ ...prev, page: 1 }));
    }, [from, to, filterManager, filterStatus]);

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

    const askConsultantFromRow = useCallback((orderId: number, prompt: string) => {
        setConsultantOrderId(orderId);
        window.dispatchEvent(new CustomEvent('okk-consultant-ask', {
            detail: {
                orderId,
                prompt,
            },
        }));
    }, []);

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

    const safeScores = Array.isArray(scores) ? scores : [];
    const filtered = [...safeScores].sort((a, b) => {
        const va = (a as any)[sortBy] ?? '';
        const vb = (b as any)[sortBy] ?? '';
        return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    useEffect(() => {
        if (selectedOrderId) setConsultantOrderId(selectedOrderId);
    }, [selectedOrderId]);

    useEffect(() => {
        if (selectedCallOrder?.order_id) setConsultantOrderId(selectedCallOrder.order_id);
    }, [selectedCallOrder]);

    useEffect(() => {
        if (selectedViolationsOrder?.order_id) setConsultantOrderId(selectedViolationsOrder.order_id);
    }, [selectedViolationsOrder]);

    useEffect(() => {
        const hasCurrent = consultantOrderId !== null && safeScores.some((score) => score.order_id === consultantOrderId);
        if (!hasCurrent) {
            setConsultantOrderId(filtered[0]?.order_id ?? null);
        }
    }, [consultantOrderId, filtered, safeScores]);

    const consultantOrder = useMemo(
        () => safeScores.find((score) => score.order_id === consultantOrderId) || filtered[0] || null,
        [consultantOrderId, filtered, safeScores]
    );

    // Удален локальный расчет avgScore так как получаем его с бекенда


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
            className={`px-1.5 py-1 text-center text-[10px] font-normal leading-tight text-gray-600 border-r border-gray-100 cursor-pointer hover:bg-gray-100 min-w-[60px] max-w-[84px] align-top relative bg-gray-50 ${sortBy === col.key ? 'text-blue-600 font-semibold bg-blue-50' : ''}`}
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
        const breakdown = s.score_breakdown?.[col.key];
        const val = (s as any)[col.key] ?? (breakdown?.result !== undefined ? breakdown.result : undefined);

        const handleCellClick = (e: React.MouseEvent) => {
            if (!breakdown) return;
            e.preventDefault();
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

        const handleCallStatusClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            setSelectedCallOrder(s);
        };

        let content;
        if (col.key === 'reactivation_status') {
            const r = s.reactivation;
            if (!r) {
                content = <span className="text-gray-300">—</span>;
            } else {
                content = (
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        {/* Письмо отправлено */}
                        <span title={`Отправлено: ${r.sent_at ? new Date(r.sent_at).toLocaleString('ru') : '?'}\n\n${r.generated_email?.substring(0, 200)}...`} className="cursor-help">
                            ✉️
                        </span>
                        
                        {/* Письмо прочитано */}
                        {r.opened_at ? (
                            <span title={`Прочитано: ${new Date(r.opened_at).toLocaleString('ru')}`} className="cursor-help">
                                👁️
                            </span>
                        ) : (
                            <span className="opacity-20 grayscale" title="Еще не прочитано">👁️</span>
                        )}

                        {/* Ответ клиента */}
                        {r.status === 'replied' && (
                            <span 
                                title={`Ответ: ${r.replied_at ? new Date(r.replied_at).toLocaleString('ru') : '?'}\n\n${r.client_reply}`} 
                                className="cursor-help flex items-center gap-0.5"
                            >
                                💬 {r.intent_status === 'POSITIVE' ? '🔥' : r.intent_status === 'NEGATIVE' ? '🚫' : '⏳'}
                            </span>
                        )}
                    </div>
                );
            }
        } else if (col.key === 'calls_status') {
            const hasCalls = val === 'Дозвон есть' || val === 'Попытки без ответа';
            content = (
                <button
                    onClick={hasCalls ? handleCallStatusClick : undefined}
                    className={`rounded px-1 py-0.5 text-[10px] leading-none transition-colors ${hasCalls
                        ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold underline decoration-blue-300 underline-offset-2'
                        : 'text-gray-400'
                        }`}
                >
                    {val ?? '—'}
                </button>
            );
        } else if (col.type === 'bool') {
            content = <C v={val} onClick={breakdown ? handleCellClick : undefined} />;
        } else if (col.type === 'num') {
            content = <span className="text-[10px] text-gray-600">{val ?? '—'}</span>;
        } else {
            content = <span className="text-[10px] text-gray-600" title={val}>{val ?? '—'}</span>;
        }

        return <td key={col.key} className={`px-1 py-1 text-center border-r border-gray-100 ${cellBg}`}>{content}</td>;
    };

    return (
        <>
            {selectedOrderId && (
                <OrderDetailsModal
                    orderId={selectedOrderId}
                    isOpen={!!selectedOrderId}
                    onClose={() => setSelectedOrderId(null)}
                />
            )}
            <div className="relative flex overflow-hidden bg-[#eef3f7]" style={{ height: 'calc(100dvh - 60px)' }}>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:min-h-0 md:border md:border-slate-200/80 md:bg-white md:shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            {/* Header / Run Bar (Ultra Compact) */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-2.5 py-1 md:px-3 md:py-2 gap-2 flex-shrink-0 relative z-30">
                <div className="flex items-center gap-1.5">
                    <Link href="/" className="p-0.5 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
                        ←
                    </Link>
                    <div>
                        <h1 className="text-xs md:text-sm font-black text-gray-800 leading-tight">ОКК</h1>
                        <div className="text-[8px] font-bold text-blue-600 uppercase md:block hidden">{pagination.totalCount} ЗАКАЗОВ</div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {currentCapability.canViewAudit && (
                        <Link
                            href="/okk/audit"
                            className="hidden md:inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700 transition-colors hover:bg-violet-100"
                        >
                            Аудит Семёна
                        </Link>
                    )}
                    {/* Compact Run Controls */}
                    <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-100">
                        {currentCapability.canRunBulkOperations ? (
                            <>
                                <input
                                    type="text"
                                    placeholder="Заказ..."
                                    value={targetOrderId}
                                    onChange={(e) => setTargetOrderId(e.target.value)}
                                    className="bg-transparent border-none text-[9px] font-bold w-10 focus:ring-0 p-0 h-4"
                                />
                                <div className="w-px h-3 bg-gray-200" />
                                <button
                                    onClick={runAll}
                                    disabled={running}
                                    className={`${running ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'} px-1.5 py-0.5 rounded text-[8px] font-black transition-all`}
                                >
                                    {running ? '..' : targetOrderId ? 'FIX' : 'RUN'}
                                </button>
                                <CountdownTimer />
                            </>
                        ) : (
                            <CountdownTimer />
                        )}
                    </div>

                    <div className="hidden gap-3 ml-1.5 md:flex">
                        <div className="text-right">
                            <div className="text-lg font-black text-green-600 leading-none">{averages.filteredAvgScore}%</div>
                            <div className="text-[8px] font-black text-gray-400 uppercase tracking-tight">
                                {currentCapability.dataScope === 'own' ? 'ваш средний %' : filterManager.length > 0 ? 'средний % менеджера' : 'текущий фильтр %'}
                            </div>
                        </div>
                        {currentCapability.dataScope !== 'own' && (
                            <>
                                <div className="w-px h-7 bg-gray-200" />
                                <div className="text-right">
                                    <div className="text-lg font-black text-blue-600 leading-none">{averages.totalAvgScore}%</div>
                                    <div className="text-[8px] font-black text-gray-400 uppercase tracking-tight">средний % по ОП</div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex gap-3 md:hidden flex items-end">
                        <div className="text-right flex flex-col items-end">
                            <div className="text-sm font-black text-green-600 leading-none">{averages.filteredAvgScore}%</div>
                            <div className="text-[8px] font-black text-gray-400 uppercase leading-none">
                                {currentCapability.dataScope === 'own' ? 'ваш' : 'фильтр'}
                            </div>
                        </div>
                        {currentCapability.dataScope !== 'own' && (
                            <>
                                <div className="w-px h-6 bg-gray-200" />
                                <div className="text-right flex flex-col items-end">
                                    <div className="text-sm font-black text-blue-600 leading-none">{averages.totalAvgScore}%</div>
                                    <div className="text-[8px] font-black text-gray-400 uppercase leading-none">оп</div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Filter Row */}
            <div className="bg-white border-b border-gray-100 px-2.5 py-1 flex flex-wrap items-center gap-1.5 flex-shrink-0 relative z-40 shadow-sm">
                {currentCapability.dataScope === 'all' && (
                    <MultiSelect
                        options={activeManagers.map(m => ({ value: m.id.toString(), label: m.name }))}
                        selectedValues={filterManager}
                        onChange={setFilterManager}
                        placeholder="Все менеджеры"
                        icon={<span className="text-[10px]">👤</span>}
                    />
                )}

                <MultiSelect
                    options={availableStatuses.map(s => ({ value: s.code, label: s.label }))}
                    selectedValues={filterStatus}
                    onChange={setFilterStatus}
                    placeholder="Все статусы"
                    icon={<span className="text-[10px]">✨</span>}
                />

                {/* Кнопка настройки колонок */}
                <div className="relative">
                    <button
                        onClick={() => setColumnSettingsOpen(prev => !prev)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                            hasHiddenColumns
                                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 shadow-sm shadow-amber-100'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Колонки
                        {hasHiddenColumns && (
                            <span className="bg-amber-500 text-white text-[8px] font-black px-1 py-0.5 rounded-full min-w-[16px] text-center leading-none">
                                {hiddenColumns.size}
                            </span>
                        )}
                    </button>
                    {columnSettingsOpen && (
                        <ColumnSettingsPanel
                            hiddenColumns={hiddenColumns}
                            onToggle={toggleColumnVisibility}
                            onClose={() => setColumnSettingsOpen(false)}
                        />
                    )}
                </div>

                {/* Pagination (Compact inline) */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center bg-gray-50 rounded p-0.5 border border-gray-100 shrink-0">
                        <button onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))} disabled={pagination.page === 1}
                            className="p-0.5 hover:bg-gray-100 disabled:opacity-20"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                        <span className="text-[8px] font-black text-gray-500 px-1 min-w-[30px] text-center">{pagination.page}/{pagination.totalPages}</span>
                        <button onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))} disabled={pagination.page === pagination.totalPages}
                            className="p-0.5 hover:bg-gray-100 disabled:opacity-20"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                    </div>
                )}
            </div>

            {/* Data Area: High Contrast for Mobile */}
            <div className={`relative z-10 min-h-0 min-w-0 flex-1 overflow-auto font-sans ${loading ? 'bg-gray-50' : 'bg-gray-300 md:bg-gray-100/30'}`}>
                {/* Desktop View */}
                <div className="hidden md:block">
                    <table className="w-full min-w-max border-collapse text-[11px]">
                        <thead className="sticky top-0 z-[50]">
                            <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 shadow-sm">
                                <th rowSpan={2} className="w-[40px] min-w-[40px] max-w-[40px] p-0 text-center align-middle sticky left-0 bg-gray-100 z-[60] border-r border-gray-200 font-semibold shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                </th>
                                <th rowSpan={2} className="px-1.5 py-1.5 text-left sticky left-[40px] bg-gray-100 z-[60] border-r border-gray-200 font-semibold min-w-[148px] w-[148px] text-[10px]">Заказ</th>
                                <th rowSpan={2} className="px-1.5 py-1.5 text-left sticky left-[188px] bg-gray-100 z-[60] border-r border-gray-200 font-semibold text-[10px] leading-tight text-gray-700 min-w-[112px] w-[112px] break-words whitespace-normal shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">МОП</th>
                                {visibleColGroups.map(g => (<th key={g.label} colSpan={g.cols.length} className={`px-1.5 py-1 text-center text-[10px] font-semibold border-r border-b border-gray-200 relative bg-gray-100 ${g.color}`}>{g.label}</th>))}
                                <th rowSpan={2} className="px-1.5 py-1.5 text-center bg-red-50 text-red-700 border-r border-gray-200 font-semibold text-[10px] min-w-[58px] w-[58px] relative">Нарушения</th>
                                <th colSpan={4} className="px-1.5 py-1 text-center text-[10px] font-semibold bg-gray-200 text-gray-700 border-r border-b border-gray-200 relative">Оценка выполнения</th>
                            </tr>
                            <tr className="bg-gray-50 border-b border-gray-200 shadow-sm">
                                {visibleColGroups.map(g => g.cols.map(col => <ColTh key={col.key} col={col} />))}
                                {SCORE_COLS.map(col => <ColTh key={col.key} col={col as any} />)}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={100} className="text-center py-12 text-gray-400">Загрузка...</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={100} className="text-center py-12 text-gray-400">Нет данных.</td></tr>
                            ) : filtered.map((s, i) => {
                                const isSelected = selectedIds.has(s.order_id);
                                const rowBg = isSelected ? 'bg-blue-50' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50');
                                const stickyClass = `${rowBg} group-hover:bg-yellow-50 z-10`;
                                return (
                                    <tr key={s.order_id} className={`group border-b border-gray-100 ${rowBg} hover:bg-yellow-50`}>
                                        <td className={`w-[40px] min-w-[40px] max-w-[40px] p-0 sticky left-0 border-r border-gray-200 text-center align-middle ${stickyClass}`}><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(s.order_id)} className="w-4 h-4 rounded border-gray-300 text-blue-600" /></td>
                                        <td className={`px-1.5 py-1 sticky left-[40px] min-w-[148px] w-[148px] max-w-[148px] border-r border-gray-200 align-top ${stickyClass}`}>
                                            <div className="grid grid-rows-2 gap-0.5 min-w-0">
                                                <div className="grid min-w-0 items-center gap-1" style={{ gridTemplateColumns: '14px auto minmax(0, 1fr)' }}>
                                                    <button onClick={() => handleSingleRun(s.order_id)} disabled={running} className="flex h-[14px] w-[14px] items-center justify-center text-[10px] leading-none hover:scale-125 disabled:opacity-30">↩️</button>
                                                    <a href={`https://zmktlt.retailcrm.ru/orders/${s.order_id}/edit`} target="_blank" rel="noreferrer" className="truncate text-[10px] font-bold text-blue-600 hover:underline font-sans">#{s.order_id}</a>
                                                    <span
                                                        className="block min-w-0 truncate rounded-full px-1 py-0.5 text-[8px] font-bold leading-tight whitespace-nowrap"
                                                        style={getBadgeStyle(s.status_color)}
                                                        title={s.status_label || s.order_status || '—'}
                                                    >
                                                        {s.status_label || s.order_status || '—'}
                                                    </span>
                                                </div>
                                                <div className="grid min-w-0 items-center gap-1.5 pl-[19px]" style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }}>
                                                    <button
                                                        onClick={() => setSelectedOrderId(s.order_id)}
                                                        className="truncate text-left text-[9px] font-semibold text-blue-600 hover:underline"
                                                    >
                                                        Карточка
                                                    </button>
                                                    <span className="block min-w-0 truncate text-[9px] font-semibold text-gray-700 whitespace-nowrap">
                                                        {s.total_sum ? s.total_sum.toLocaleString('ru-RU') : '0'} ₽
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={`px-1.5 py-1 sticky left-[188px] min-w-[112px] w-[112px] max-w-[112px] border-r border-gray-200 text-[10px] font-medium leading-tight text-gray-800 break-words whitespace-normal align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${stickyClass}`}>{s.manager_name || '—'}</td>
                                        {visibleColGroups.map(g => g.cols.map(col => renderCell(s, col, g.cellBg)))}
                                        <td className="px-1.5 py-1 text-center border-r border-gray-200 bg-red-50/30">
                                            {s.violations && s.violations.length > 0 ? (
                                                <button onClick={() => setSelectedViolationsOrder(s)} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 transition-colors hover:bg-red-200">
                                                    🔴 {s.violations.length}
                                                </button>
                                            ) : (
                                                <span className="text-[10px] font-semibold text-gray-400">0</span>
                                            )}
                                        </td>
                                        {(() => {
                                            const adjDeal = hasHiddenColumns ? recalcDealScorePct(s, hiddenColumns) : s.deal_score_pct;
                                            const adjScript = hasHiddenColumns ? recalcScriptScorePct(s, hiddenColumns) : s.script_score_pct;
                                            const adjDealScore = hasHiddenColumns
                                                ? (adjDeal !== null ? Math.round((adjDeal / 100) * DEAL_CHECK_KEYS.filter(k => !hiddenColumns.has(k)).length) : null)
                                                : s.deal_score;
                                            const adjScriptScore = hasHiddenColumns
                                                ? (adjScript !== null ? Math.round((adjScript / 100) * SCRIPT_CHECK_KEYS.filter(k => !hiddenColumns.has(k)).length) : null)
                                                : s.script_score;
                                            return (
                                                <>
                                                    <td className="px-1.5 py-1 text-center border-r border-gray-100 bg-gray-50 text-[10px] font-bold">{adjDealScore ?? '—'}</td>
                                                    <td className="px-1.5 py-1 text-center border-r border-gray-100 bg-gray-50"><Pct n={adjDeal} /></td>
                                                    <td className="px-1.5 py-1 text-center border-r border-gray-100 bg-gray-50 text-[10px]">{adjScriptScore ?? '—'}</td>
                                                    <td className="px-1.5 py-1 text-center bg-gray-50"><Pct n={adjScript} /></td>
                                                </>
                                            );
                                        })()}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View (Sticker Mode) */}
                <div className="block md:hidden p-1.5 space-y-1">
                    {loading ? (
                        <div className="text-center py-12 text-gray-500 font-bold">ОБРАБОТКА...</div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">Нет данных.</div>
                    ) : filtered.map((s) => (
                        <div
                            key={s.order_id}
                            onClick={() => {
                                setSelectedCallOrder(s);
                                setConsultantOrderId(s.order_id);
                            }}
                            className="bg-white rounded border border-gray-200 shadow-sm active:bg-gray-50 transition-all cursor-pointer relative overflow-hidden flex items-center h-[52px]"
                        >
                            <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: s.status_color || '#e5e7eb' }} />

                            <div className="flex-1 min-w-0 px-2.5 py-1.5 flex flex-col justify-between h-full">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <a
                                            href={`https://zmktlt.retailcrm.ru/orders/${s.order_id}/edit`}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-[11px] font-black text-blue-600 hover:text-blue-800 hover:underline leading-none"
                                        >
                                            #{s.order_id}
                                        </a>
                                        <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1 rounded">
                                            {s.total_sum ? s.total_sum.toLocaleString('ru-RU') : '0'}₽
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedOrderId(s.order_id);
                                                setConsultantOrderId(s.order_id);
                                            }}
                                            className="px-1.5 py-0.5 text-[9px] font-bold rounded-full border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                                        >
                                            Карточка
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1 scale-90 origin-right">
                                        <span className="text-[8px] font-black text-gray-400 uppercase leading-none">SCORE</span>
                                        <Pct n={s.deal_score_pct} />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <span className="text-[9px] font-bold text-gray-500 truncate max-w-[80px]">
                                            {s.manager_name ? s.manager_name.split(' ')[0] : '—'}
                                        </span>
                                        <span className="text-[8px] px-1 py-0.5 rounded font-black uppercase leading-none truncate max-w-[80px]" style={getBadgeStyle(s.status_color)}>
                                            {s.status_label || 'Status'}
                                        </span>
                                        {/* Реактивация в мобилке */}
                                        {s.reactivation && (
                                            <div className="flex items-center gap-0.5 ml-1">
                                                <span>✉️</span>
                                                {s.reactivation.opened_at && <span>👁️</span>}
                                                {s.reactivation.status === 'replied' && <span>💬</span>}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center text-blue-500 gap-0.5">
                                        <span className="text-[9px] font-black uppercase">АНАЛИЗ</span>
                                        <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </div>
                                </div>

                                <div className="mt-1 flex flex-wrap gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            askConsultantFromRow(s.order_id, 'Как работает алгоритм оценки ОКК?');
                                        }}
                                        className="px-1.5 py-0.5 text-[8px] font-bold rounded-full border border-sky-200 text-sky-700 bg-sky-50"
                                    >
                                        Алгоритм
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            askConsultantFromRow(s.order_id, 'Что означают крестики и галочки?');
                                        }}
                                        className="px-1.5 py-0.5 text-[8px] font-bold rounded-full border border-amber-200 text-amber-700 bg-amber-50"
                                    >
                                        Критерии
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            askConsultantFromRow(s.order_id, 'Откуда система берёт данные для оценки?');
                                        }}
                                        className="px-1.5 py-0.5 text-[8px] font-bold rounded-full border border-violet-200 text-violet-700 bg-violet-50"
                                    >
                                        Данные
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            askConsultantFromRow(s.order_id, 'Что делать, если данные в CRM заполнены неполно?');
                                        }}
                                        className="px-1.5 py-0.5 text-[8px] font-bold rounded-full border border-rose-200 text-rose-700 bg-rose-50"
                                    >
                                        Подсказка
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bottom Pagination (Desktop) */}
            {pagination.totalPages > 1 && (
                <div className="hidden md:flex px-4 py-3 bg-white border-t border-gray-100 items-center justify-between flex-shrink-0">
                    <span className="text-[11px] text-gray-500 font-medium">Показано {scores.length} из {pagination.totalCount} заказов</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))} disabled={pagination.page === 1}
                            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold hover:bg-gray-50 disabled:opacity-30 transition-colors">Назад</button>
                        <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                                let pageNum = i + 1;
                                if (pagination.totalPages > 5 && pagination.page > 3) {
                                    pageNum = pagination.page - 2 + i;
                                    if (pageNum + (4 - i) > pagination.totalPages) pageNum = pagination.totalPages - 4 + i;
                                }
                                if (pageNum > pagination.totalPages) return null;
                                return (
                                    <button key={pageNum} onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${pagination.page === pageNum ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'hover:bg-gray-100 text-gray-600 border border-transparent hover:border-gray-200'}`}>{pageNum}</button>
                                );
                            })}
                        </div>
                        <button onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))} disabled={pagination.page === pagination.totalPages}
                            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold hover:bg-gray-50 disabled:opacity-30 transition-colors">Вперед</button>
                    </div>
                </div>
            )}

            {activeExplain && (
                <ExplainPopover label={activeExplain.label} info={activeExplain.info} onClose={() => setActiveExplain(null)} pos={activeExplain.pos} />
            )}

            {selectedCallOrder && (
                <CallDetailModal order={selectedCallOrder} onClose={() => setSelectedCallOrder(null)} />
            )}

            {selectedViolationsOrder && (
                <ViolationsModal order={selectedViolationsOrder} onClose={() => setSelectedViolationsOrder(null)} />
            )}
            </div>

            <OKKConsultantPanel selectedOrder={consultantOrder} />
        </div>
        </>
    );
}

function ViolationsModal({ order, onClose }: { order: OrderScore, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 transition-opacity" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between bg-red-50">
                    <div>
                        <h3 className="font-black text-red-800 text-lg">Нарушения процесса</h3>
                        <div className="text-sm font-semibold text-red-600/80">По заказу #{order.order_id}</div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200 hover:text-red-700 transition-colors">✕</button>
                </div>
                <div className="p-5 max-h-[60vh] overflow-y-auto bg-gray-50/50">
                    {order.violations && order.violations.length > 0 ? (
                        <div className="space-y-3">
                            {order.violations.map((v, i) => (
                                <div key={i} className="bg-white p-4 rounded-xl border border-red-100 shadow-sm flex flex-col gap-2 relative overflow-hidden group">
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-red-400 to-red-600"></div>
                                    <div className="flex justify-between items-start pl-2">
                                        <span className="text-sm font-bold text-gray-800 leading-snug">{v.description || 'Нарушение правила'}</span>
                                        <span className="text-xs font-black text-red-600 bg-red-50 px-2 py-1 rounded-md ml-4 shrink-0 shadow-[inset_0_0_0_1px_#fee2e2]">-{v.penalty_points || 0} баллов</span>
                                    </div>
                                    <div className="text-xs text-gray-500 flex gap-2 items-center pl-2">
                                        <span className="font-medium bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">📅 {new Date(v.created_at).toLocaleString('ru-RU')}</span>
                                        <span>•</span>
                                        <span className="font-medium">👤 Менеджер: {v.manager_name || order.manager_name || 'Неизвестен'}</span>
                                    </div>
                                    {v.status_from && v.status_to && (
                                        <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100 mt-1 ml-2 inline-flex items-center gap-2">
                                            <span className="text-gray-400">Переход:</span>
                                            <span className="font-bold text-gray-700">{v.status_from}</span>
                                            <span className="text-blue-500">→</span>
                                            <span className="font-bold text-gray-700">{v.status_to}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 flex flex-col items-center justify-center bg-white rounded-xl border border-gray-100 border-dashed">
                            <span className="text-4xl mb-3">✨</span>
                            <div className="text-gray-700 font-bold mb-1">Нет зафиксированных нарушений</div>
                            <div className="text-gray-400 text-sm max-w-xs mx-auto">По этому заказу менеджер всё делал по правилам или система не зафиксировала ошибок.</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}



function CallDetailModal({ order, onClose }: { order: OrderScore, onClose: () => void }) {
    const [calls, setCalls] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCallIndex, setSelectedCallIndex] = useState(0);
    const [transcribing, setTranscribing] = useState(false);
    const [mobileTab, setMobileTab] = useState<'calls' | 'transcript' | 'analysis'>('calls');

    const fetchCalls = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/okk/scores/${order.order_id}/calls`);
            const data = await res.json();
            setCalls(data.calls || []);
            if (data.calls?.length > 0) {
                // Select first call with transcript if available
                const firstWithTranscript = data.calls.findIndex((c: any) => !!c.transcript);
                setSelectedCallIndex(firstWithTranscript !== -1 ? firstWithTranscript : 0);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [order.order_id]);

    useEffect(() => {
        fetchCalls();
    }, [fetchCalls]);

    const activeCall = calls[selectedCallIndex];

    const primaryClientNumber = activeCall
        ? activeCall.direction === 'incoming'
            ? (activeCall.from_number || activeCall.from_number_normalized)
            : (activeCall.to_number || activeCall.to_number_normalized)
        : null;

    const secondaryClientNumber = activeCall
        ? activeCall.direction === 'incoming'
            ? (activeCall.to_number || activeCall.to_number_normalized)
            : (activeCall.from_number || activeCall.from_number_normalized)
        : null;

    const callNumbers = Array.from(
        new Set(
            [primaryClientNumber, secondaryClientNumber].filter(
                (num): num is string => Boolean(num)
            )
        )
    );

    const managerIdString = typeof order.manager_id === 'number' ? String(order.manager_id) : null;
    const orderIdString = String(order.order_id);

    const handleTranscribe = async () => {
        if (!activeCall?.recording_url || transcribing) return;
        setTranscribing(true);
        try {
            const res = await fetch('/api/okk/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callId: activeCall.telphin_call_id,
                    recordingUrl: activeCall.recording_url
                })
            });
            const data = await res.json();
            if (data.success) {
                // Refresh calls to get the new transcript
                await fetchCalls();
                setMobileTab('transcript'); // Auto-switch to transcript tab on mobile
            } else {
                alert(`Ошибка транскрибации: ${data.error}`);
            }
        } catch (e: any) {
            alert(`Ошибка: ${e.message}`);
        } finally {
            setTranscribing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-white md:bg-black/60 md:backdrop-blur-sm md:p-4 animate-in fade-in duration-200">
            <div className="bg-white md:rounded-2xl shadow-none md:shadow-2xl w-full h-full md:max-h-[90vh] md:max-w-5xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-3 md:p-4 border-b flex justify-between items-center bg-gray-50/80">
                    <div>
                        <h2 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-1.5 md:gap-2">
                            <span>📞 <span className="hidden md:inline">Детали звонков</span></span>
                            <a
                                href={`https://zmktlt.retailcrm.ru/orders/${order.order_id}/edit`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                                #{order.order_id}
                            </a>
                        </h2>
                        <p className="text-[10px] md:text-xs text-gray-500 mt-0.5 max-w-[200px] md:max-w-none truncate">
                            {order.manager_name} • {order.status_label}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 md:bg-white md:hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-gray-900 absolute right-2 top-2 md:relative md:right-auto md:top-auto z-10">✕</button>
                </div>

                {/* Mobile Tabs */}
                <div className="flex md:hidden border-b bg-white text-[10px] font-black uppercase tracking-widest text-gray-500 flex-shrink-0">
                    <button
                        onClick={() => setMobileTab('calls')}
                        className={`flex-1 py-3 text-center border-b-2 transition-colors ${mobileTab === 'calls' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                    >
                        Звонки
                    </button>
                    <button
                        onClick={() => setMobileTab('transcript')}
                        className={`flex-1 py-3 text-center border-b-2 transition-colors ${mobileTab === 'transcript' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                    >
                        Текст
                    </button>
                    <button
                        onClick={() => setMobileTab('analysis')}
                        className={`flex-1 py-3 text-center border-b-2 transition-colors ${mobileTab === 'analysis' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                    >
                        Анализ
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
                    {/* Sidebar: Call List */}
                    <div className={`${mobileTab === 'calls' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r bg-gray-50/30 overflow-y-auto flex-col`}>
                        <div className="p-2 md:p-3 border-b bg-white/50 sticky top-0">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">История разговоров</h3>
                        </div>
                        {calls.some(c => c.is_fallback) && (
                            <div className="p-3 m-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 leading-tight shadow-sm animate-pulse flex gap-2 items-start">
                                <span className="text-sm">⏳</span>
                                <div>
                                    <span className="font-bold block">Звонки найдены, но еще не обработаны!</span>
                                    Семен скачивает звонки и делает транскрибацию. Развернутая оценка появится чуть позже.
                                </div>
                            </div>
                        )}
                        {loading ? (
                            <div className="flex-1 flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                            </div>
                        ) : calls.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 text-xs italic">Звонки не найдены</div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {calls.map((call, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            setSelectedCallIndex(idx);
                                        }}
                                        className={`w-full text-left p-3 md:p-4 hover:bg-white/80 transition-all border-l-4 ${selectedCallIndex === idx ? 'bg-white border-blue-600 shadow-sm' : 'border-transparent'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${call.direction === 'outgoing' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                {call.direction === 'outgoing' ? 'Исходящий' : 'Входящий'}
                                            </span>
                                            <span className="text-[10px] text-gray-400 font-mono">
                                                {call.duration_sec}с
                                            </span>
                                        </div>
                                        <div className="text-xs font-bold text-gray-800 flex justify-between">
                                            <span>{new Date(call.started_at).toLocaleDateString('ru-RU')}</span>
                                            <span className="text-[10px] text-gray-500 font-normal">
                                                {new Date(call.started_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        {call.match_explanation?.includes('[Внимание: звонил другой менеджер]') && (
                                            <div className="mt-1 text-[9px] font-black text-red-600 bg-red-50 rounded px-1.5 py-0.5 inline-block border border-red-100 uppercase tracking-tight">
                                                ⚠️ Другой менеджер
                                            </div>
                                        )}
                                        {call.transcript && (
                                            <div className="mt-2 text-[10px] text-blue-500 flex items-center gap-1">
                                                <span>📝 Транскрибация</span>
                                            </div>
                                        )}
                                        {selectedCallIndex === idx && (
                                            <div className="mt-2 text-[9px] text-blue-600 font-bold md:hidden text-right">
                                                Выбран ✔
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Content: Transcription + Analysis */}
                    <div className={`${mobileTab !== 'calls' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 bg-white`}>
                        {loading ? (
                            <div className="flex-1" />
                        ) : activeCall ? (
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {/* Call Stats Header (Always visible when not in 'calls' tab on mobile) */}
                                <div className="p-3 md:p-4 border-b bg-white flex flex-col md:flex-row md:items-center justify-between gap-2 flex-shrink-0">
                                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full">
                                        <div>
                                            <span className="text-[9px] text-gray-400 uppercase font-black block">Откуда/Куда</span>
                                            <span className="text-xs font-mono font-bold text-gray-700">
                                                {activeCall.from_number || activeCall.from_number_normalized} → {activeCall.to_number || activeCall.to_number_normalized}
                                            </span>
                                        </div>
                                        {activeCall.recording_url && (
                                            <div className="flex items-center gap-2 w-full md:w-auto">
                                                <audio
                                                    src={activeCall.raw_payload?.storage_url || `/api/okk/proxy-audio?url=${encodeURIComponent(activeCall.recording_url)}`}
                                                    controls
                                                    className="h-10 md:h-8 md:w-64 w-full accent-blue-600"
                                                />
                                                <a
                                                    href={activeCall.raw_payload?.storage_url || activeCall.recording_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Скачать/Открыть"
                                                    className="p-1.5 px-3 text-xs font-bold hover:bg-gray-100 rounded-xl text-gray-400 hover:text-blue-600 transition-colors flex items-center gap-1 whitespace-nowrap border border-gray-100 hidden md:flex"
                                                >
                                                    <span>Скачать</span>
                                                </a>
                                            </div>
                                        )}
                                        <div className="flex flex-col gap-1 w-full md:w-auto">
                                            <span className="text-[9px] text-gray-400 uppercase font-black">Позвонить клиенту</span>
                                            {managerIdString ? (
                                                callNumbers.length > 0 ? (
                                                    <div className="flex flex-wrap items-center gap-4">
                                                        {callNumbers.map((number, idx) => (
                                                            <div key={`${number}-${idx}`} className="flex flex-col gap-1 min-w-[160px]">
                                                                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">
                                                                    {idx === 0 ? 'Основной номер' : 'Дополнительный'}
                                                                </span>
                                                                <span className="text-xs font-mono text-gray-900">{number}</span>
                                                                <CallInitiator
                                                                    phoneNumber={number}
                                                                    managerId={managerIdString}
                                                                    orderId={orderIdString}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-gray-400">Номер телефона не найден</span>
                                                )
                                            ) : (
                                                <span className="text-[11px] text-gray-400">Назначьте менеджера, чтобы позвонить клиенту</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
                                    {/* Left: Transcription */}
                                    <div className={`${mobileTab === 'transcript' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r overflow-hidden`}>
                                        <div className="p-2 md:p-3 bg-gray-50/50 border-b flex-shrink-0 hidden md:block">
                                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Текст разговора</h4>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 bg-gray-50/20">
                                            {activeCall.transcript ? (
                                                <div className="text-xs md:text-sm text-gray-700 leading-relaxed font-sans space-y-1">
                                                    {activeCall.transcript.split('\n').map((line: string, i: number) => {
                                                        const isManager = line.startsWith('Менеджер:');
                                                        const isClient = line.startsWith('Клиент:');

                                                        if (isManager) {
                                                            return (
                                                                <div key={i} className="mb-2">
                                                                    <span className="text-blue-700 font-bold italic">Менеджер: </span>
                                                                    {line.replace('Менеджер:', '')}
                                                                </div>
                                                            );
                                                        }
                                                        if (isClient) {
                                                            return (
                                                                <div key={i} className="mb-2">
                                                                    <span className="text-orange-600 font-bold italic">Клиент: </span>
                                                                    {line.replace('Клиент:', '')}
                                                                </div>
                                                            );
                                                        }
                                                        return <div key={i} className="mb-2">{line}</div>;
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                                                    <span className="text-3xl">🔇</span>
                                                    <div className="text-center">
                                                        <p className="text-xs italic mb-4">Транскрибация недоступна</p>
                                                        {activeCall.recording_url && (
                                                            <button
                                                                onClick={handleTranscribe}
                                                                disabled={transcribing}
                                                                className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 disabled:opacity-50 transition-all active:scale-95 border border-blue-100 shadow-sm"
                                                            >
                                                                {transcribing ? (
                                                                    <span className="flex items-center gap-2">
                                                                        <div className="w-3 h-3 border-2 border-blue-300 border-b-blue-600 rounded-full animate-spin"></div>
                                                                        Обработка...
                                                                    </span>
                                                                ) : 'Запустить транскрибацию'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right: Maxim's Analysis */}
                                    <div className={`${mobileTab === 'analysis' ? 'flex' : 'hidden'} md:flex w-full md:w-96 flex-col overflow-hidden bg-gray-50/10`}>
                                        <div className="p-2 md:p-3 bg-fuchsia-50 border-b border-fuchsia-100 flex items-center gap-2 flex-shrink-0">
                                            <span className="text-lg">🤓</span>
                                            <div>
                                                <h4 className="text-xs font-bold text-fuchsia-900">Анализ Максима</h4>
                                                <p className="text-[9px] text-fuchsia-600 font-black uppercase tracking-tighter leading-none">Сводный срез по всем звонкам</p>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 md:space-y-6">
                                            {/* Summary */}
                                            {order.evaluator_comment ? (
                                                <div>
                                                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                                        <span>📋</span> Общее резюме
                                                    </h5>
                                                    <div className="text-xs text-gray-800 bg-white p-3 md:p-4 rounded-xl border border-gray-100 shadow-sm leading-relaxed font-medium">
                                                        {order.evaluator_comment}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-center text-xs text-gray-400 italic py-8">
                                                    Никакого анализа по этому заказу еще нет.
                                                </div>
                                            )}

                                            {/* Criteria reasoning */}
                                            {order.score_breakdown && Object.keys(order.score_breakdown).length > 0 && (
                                                <div>
                                                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1">
                                                        <span>🔍</span> Ключевые моменты
                                                    </h5>
                                                    <div className="space-y-2 md:space-y-3">
                                                        {Object.entries(order.score_breakdown || {})
                                                            .filter(([key]) => isVisibleBreakdownKey(key))
                                                            .filter(([_, data]) => !!data.reason)
                                                            .map(([key, data]) => (
                                                                <div key={key} className="bg-white p-2.5 md:p-3 rounded-xl border border-gray-100 shadow-sm">
                                                                    <div className="flex items-center gap-1.5 mb-1.5">
                                                                        <span className={data.result ? 'text-green-500' : 'text-red-500'}>
                                                                            {data.result ? '✅' : '❌'}
                                                                        </span>
                                                                        <span className="text-[10px] font-bold text-gray-700">
                                                                            {formatQualityCriterionLabel(key)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[11px] text-gray-600 leading-normal italic">
                                                                        «{data.reason}»
                                                                    </p>
                                                                </div>
                                                            ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center bg-gray-50">
                                <div className="max-w-xs">
                                    <div className="text-4xl mb-4">👆</div>
                                    Выберите звонок из списка на вкладке "Звонки", чтобы просмотреть детали.
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="hidden md:flex p-4 border-t bg-gray-50 flex-shrink-0 justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all active:scale-95"
                    >
                        Понятно
                    </button>
                </div>
            </div>
        </div>
    );
}
