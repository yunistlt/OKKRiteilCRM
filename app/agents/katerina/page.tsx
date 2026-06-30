import Link from 'next/link';
import { supabase } from '@/utils/supabase';
import { getManagerPool, getManagerNames, getBalanceWindowDays, getRecentAssignmentCounts } from '@/lib/email/assign';
import { getDepartmentRoutes, isForwardEnabled, getOrderBlocklist } from '@/lib/email/routes';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import RoutesSettings from './RoutesSettings';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
    new_request: { label: 'Новая заявка', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    accounting: { label: 'Бухгалтерия', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
    logistics: { label: 'Логистика', cls: 'bg-sky-100 text-sky-800 border-sky-200' },
    legal: { label: 'Юрист', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    procurement: { label: 'Снабжение', cls: 'bg-teal-100 text-teal-800 border-teal-200' },
    reply_thread: { label: 'Переписка по заказу', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    noreply: { label: 'Робот / noreply', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    not_request: { label: 'Не заявка', cls: 'bg-amber-100 text-amber-900 border-amber-200' },
};

function fmt(dt?: string | null) {
    if (!dt) return '—';
    try { return new Date(dt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
}

function preview(t?: string | null, n = 150) {
    if (!t) return '';
    const s = t.replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
}

export default async function KaterinaPage() {
    // 1) живой статус агента
    const { data: agent } = await supabase
        .from('okk_agent_status').select('*').eq('agent_id', 'katerina').maybeSingle();

    // 2) режим (сухой прогон?)
    const { data: cfg } = await supabase
        .from('email_intake_config').select('create_orders').maybeSingle();
    const dryRun = !cfg?.create_orders;

    // 2b) маршруты пересылки в отделы и режим пересылки
    const [routes, forwardEnabled, orderBlocklist, session] = await Promise.all([getDepartmentRoutes(), isForwardEnabled(), getOrderBlocklist(), getSession()]);
    const routeList = ['accounting', 'logistics', 'legal', 'procurement'].map((d) => routes[d]).filter(Boolean);
    const canEditSettings = hasAnyRole(session, ['admin', 'rop']);

    // 3) баланс распределения: заявки, назначенные Катериной за окно (по умолч. 7 дней)
    const pool = await getManagerPool();
    const [names, windowDays] = await Promise.all([getManagerNames(pool), getBalanceWindowDays()]);
    const load = await getRecentAssignmentCounts(pool, windowDays);

    // 4) последние разобранные письма
    const { data: recent } = await supabase
        .from('incoming_emails')
        .select('id, from_email, from_name, subject, body_text, email_type, confidence, reasoning, assigned_manager_id, created_crm_order_id, created_crm_order_number, forwarded_department, forwarded_to, status, received_at')
        .in('status', ['classified', 'processed', 'error'])
        .order('received_at', { ascending: false })
        .limit(40);

    const crmBase = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
    const orderUrl = (id?: number | null) => (crmBase && id ? `${crmBase}/orders/${id}/edit` : null);

    // 5) сводка по типам за всё накопленное
    const { data: allClassified } = await supabase
        .from('incoming_emails').select('email_type').in('status', ['classified', 'processed', 'error']);
    const counts: Record<string, number> = {};
    for (const r of allClassified || []) counts[r.email_type] = (counts[r.email_type] || 0) + 1;

    const totalEmails = (allClassified || []).length;

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-slate-50 px-6 py-8 md:px-8">
            {/* Шапка */}
            <div className="mb-6 flex items-center gap-4">
                <Link href="/agents" className="text-sm font-bold text-slate-500 hover:text-slate-800">← Все агенты</Link>
            </div>
            <div className="flex items-start gap-5 border border-slate-200 bg-white p-6">
                <div className="h-24 w-24 overflow-hidden border border-slate-200 bg-slate-100">
                    <img src="/images/agents/katerina.svg" alt="Катерина" className="h-full w-full object-cover" />
                </div>
                <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-3xl font-black tracking-tight text-slate-950">Катерина</h1>
                        <span className="border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-sky-800">Секретарь</span>
                        {dryRun ? (
                            <span className="border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-amber-900">
                                Сухой прогон — заказы не создаются
                            </span>
                        ) : (
                            <span className="border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                                Создание заказов включено
                            </span>
                        )}
                        {forwardEnabled ? (
                            <span className="border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                                Пересылка в отделы включена
                            </span>
                        ) : (
                            <span className="border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-amber-900">
                                Сухой прогон — письма не пересылаются
                            </span>
                        )}
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Разбирает входящую почту: заводит новые заявки заказом и назначает менеджера, а письма по
                        бухгалтерии, логистике и юристу пересылает в нужный отдел по содержанию.
                        Всего разобрано писем: <b>{totalEmails}</b>.
                    </p>
                </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                {/* Блок 1: процесс */}
                <section className="border border-slate-200 bg-white p-5">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Что делает сейчас</div>
                    <div className="mt-4 flex items-center gap-3">
                        <span className={`h-3 w-3 rounded-full ${agent?.status === 'working' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <span className="text-lg font-bold text-slate-900">
                            {agent?.status === 'working' ? 'В работе' : 'Ожидает'}
                        </span>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">{agent?.current_task || 'Ожидает новые письма'}</div>
                    <div className="mt-3 text-xs text-slate-400">Последняя активность: {fmt(agent?.last_active_at)}</div>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Сводка решений</div>
                        <ul className="mt-3 space-y-2 text-sm">
                            {(['new_request', 'accounting', 'logistics', 'legal', 'procurement', 'reply_thread', 'noreply', 'not_request'] as const).map((t) => (
                                <li key={t} className="flex items-center justify-between">
                                    <span className="text-slate-600">{TYPE_LABEL[t].label}</span>
                                    <span className="font-black text-slate-900">{counts[t] || 0}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                {/* Блок 2: текущая загрузка */}
                <section className="border border-slate-200 bg-white p-5">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Распределение заявок</div>
                    <div className="mt-2 text-xs text-slate-400">Заявок назначено Катериной за последние {windowDays} дн. (на этом и балансируется распределение)</div>
                    <div className="mt-4 space-y-4">
                        {pool.map((id) => {
                            const max = Math.max(1, ...pool.map((p) => load[p] || 0));
                            const val = load[id] || 0;
                            return (
                                <div key={id}>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-bold text-slate-800">{names[id] || id}</span>
                                        <span className="font-black text-slate-900">{val}</span>
                                    </div>
                                    <div className="mt-1 h-2 w-full bg-slate-100">
                                        <div className="h-2 bg-sky-500" style={{ width: `${Math.round((val / max) * 100)}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                        {pool.length === 0 ? <div className="text-sm text-slate-500">Пул менеджеров не задан.</div> : null}
                    </div>
                </section>

                {/* Блок 3: результат (последние письма) — на всю ширину под двумя */}
                <section className="border border-slate-200 bg-white p-5 lg:col-span-1">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Назначения (последние заявки)</div>
                    <ul className="mt-3 space-y-3 text-sm">
                        {(recent || []).filter((r: any) => r.email_type === 'new_request').slice(0, 12).map((r: any) => (
                            <li key={r.id} className="border-b border-slate-100 pb-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-bold text-slate-900">{names[Number(r.assigned_manager_id)] || '—'}</div>
                                    {r.created_crm_order_id && orderUrl(r.created_crm_order_id) ? (
                                        <a href={orderUrl(r.created_crm_order_id) as string} target="_blank" rel="noopener noreferrer"
                                            className="shrink-0 border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-800 hover:bg-sky-100">
                                            № {r.created_crm_order_number || r.created_crm_order_id} ↗
                                        </a>
                                    ) : (
                                        <span className="shrink-0 text-[11px] text-slate-300">без заказа</span>
                                    )}
                                </div>
                                <div className="truncate text-slate-600">{r.subject || '(без темы)'}</div>
                                <div className="truncate text-xs text-slate-400">{r.from_email}</div>
                            </li>
                        ))}
                        {(recent || []).filter((r: any) => r.email_type === 'new_request').length === 0
                            ? <li className="text-slate-500">Пока нет назначенных заявок.</li> : null}
                    </ul>
                </section>
            </div>

            {/* Настройки пересылки */}
            <RoutesSettings
                initialRoutes={routeList.map((r: any) => ({ department: r.department, label: r.label, email: r.email, is_active: r.isActive }))}
                initialCreateOrders={!dryRun}
                initialForwardEnabled={forwardEnabled}
                initialOrderBlocklist={orderBlocklist}
                canEdit={canEditSettings}
            />

            {/* Лента разбора */}
            <section className="mt-6 border border-slate-200 bg-white p-5">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Лента разбора почты</div>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                                <th className="py-2 pr-4">Время</th>
                                <th className="py-2 pr-4">Тип</th>
                                <th className="py-2 pr-4">От кого</th>
                                <th className="py-2 pr-4">Тема</th>
                                <th className="py-2 pr-4">Письмо</th>
                                <th className="py-2 pr-4">Менеджер</th>
                                <th className="py-2 pr-4">Заказ</th>
                                <th className="py-2 pr-4">Переслано</th>
                                <th className="py-2 pr-4">Вывод</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(recent || []).map((r: any) => {
                                const t = TYPE_LABEL[r.email_type] || { label: r.email_type, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
                                return (
                                    <tr key={r.id} className="border-b border-slate-50 align-top">
                                        <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-400">{fmt(r.received_at)}</td>
                                        <td className="py-2 pr-4"><span className={`border px-2 py-0.5 text-[11px] font-bold ${t.cls}`}>{t.label}</span></td>
                                        <td className="py-2 pr-4 text-slate-700">{r.from_name || r.from_email}</td>
                                        <td className="py-2 pr-4 max-w-[260px] truncate text-slate-700">{r.subject}</td>
                                        <td className="py-2 pr-4 max-w-[340px] text-xs text-slate-600">
                                            {r.body_text ? (
                                                <details>
                                                    <summary className="cursor-pointer list-none text-slate-600 hover:text-slate-900">{preview(r.body_text)}</summary>
                                                    <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap border-l-2 border-slate-200 pl-2 text-slate-700">{r.body_text}</div>
                                                </details>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-4 text-slate-700">{r.assigned_manager_id ? (names[Number(r.assigned_manager_id)] || r.assigned_manager_id) : '—'}</td>
                                        <td className="py-2 pr-4 whitespace-nowrap">
                                            {r.created_crm_order_id && orderUrl(r.created_crm_order_id) ? (
                                                <a href={orderUrl(r.created_crm_order_id) as string} target="_blank" rel="noopener noreferrer"
                                                    className="font-bold text-sky-700 hover:underline">№ {r.created_crm_order_number || r.created_crm_order_id} ↗</a>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-4 whitespace-nowrap">
                                            {r.forwarded_to ? (
                                                <span className="inline-flex flex-col" title={r.forwarded_to}>
                                                    <span className="font-bold text-violet-800">→ {TYPE_LABEL[r.forwarded_department]?.label || r.forwarded_department}</span>
                                                    <span className="text-[11px] text-slate-400">{r.forwarded_to}</span>
                                                </span>
                                            ) : ['accounting', 'logistics', 'legal', 'procurement'].includes(r.email_type) ? (
                                                r.status === 'needs_review' ? (
                                                    <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900">адрес не настроен</span>
                                                ) : r.status === 'error' ? (
                                                    <span className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-900">ошибка пересылки</span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-400">{TYPE_LABEL[r.email_type]?.label} · не отправлено</span>
                                                )
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-4 max-w-[360px] text-xs text-slate-500">{r.reasoning}</td>
                                    </tr>
                                );
                            })}
                            {(recent || []).length === 0 ? (
                                <tr><td colSpan={9} className="py-6 text-center text-slate-500">Писем пока нет — Катерина ждёт первую почту.</td></tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
