'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import type { RouteRule } from '@/lib/rbac';
import { APP_ROLES } from '@/lib/rbac';
import { DATA_SCOPE_LABELS, DEFAULT_ROLE_CAPABILITIES, EDIT_SCOPE_LABELS, ROLE_DISPLAY_ORDER, ROLE_LABELS, RoleCapabilityProfile } from '@/lib/access-control';
import { AccessAccount, AccessManagerOption, createAccessAccount, saveRoleCapabilities, saveRoutePermissions, updateAccessAccount } from './actions';

const ACCOUNT_SOURCE_LABELS = {
    profile: 'Основной аккаунт',
    legacy: 'Локальный аккаунт',
} as const;

type Props = {
    initialAccounts: AccessAccount[];
    initialManagers: AccessManagerOption[];
    initialRouteRules: RouteRule[];
    routeRulesTableReady: boolean;
    initialRoleCapabilities: RoleCapabilityProfile[];
    roleCapabilitiesTableReady: boolean;
};

export default function AccessControlClient({ initialAccounts, initialManagers, initialRouteRules, routeRulesTableReady, initialRoleCapabilities, roleCapabilitiesTableReady }: Props) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [accounts, setAccounts] = useState(initialAccounts);
    const [routeRules, setRouteRules] = useState(initialRouteRules);
    const [roleCapabilities, setRoleCapabilities] = useState(initialRoleCapabilities);
    const [search, setSearch] = useState('');
    const [message, setMessage] = useState('');
    const [showSqlGuide, setShowSqlGuide] = useState(!routeRulesTableReady || !roleCapabilitiesTableReady);
    const [newAccount, setNewAccount] = useState({
        accountType: 'legacy' as 'profile' | 'legacy',
        email: '',
        username: '',
        password: '',
        first_name: '',
        last_name: '',
        role: 'manager' as AppRole,
        retail_crm_manager_id: '',
    });

    const filteredAccounts = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return accounts;
        return accounts.filter((account) => {
            const fullName = `${account.first_name || ''} ${account.last_name || ''}`.trim().toLowerCase();
            const username = (account.username || '').toLowerCase();
            const email = (account.email || '').toLowerCase();
            return fullName.includes(needle) || username.includes(needle) || email.includes(needle) || account.role.includes(needle);
        });
    }, [accounts, search]);

    const groupedRules = useMemo(() => {
        return routeRules.reduce<Record<string, RouteRule[]>>((acc, rule) => {
            const key = rule.category || 'Доступ';
            if (!acc[key]) acc[key] = [];
            acc[key].push(rule);
            return acc;
        }, {});
    }, [routeRules]);

    const orderedRoleCapabilities = useMemo(() => {
        const map = new Map(roleCapabilities.map((item) => [item.role, item]));
        return ROLE_DISPLAY_ORDER.map((role) => map.get(role) || DEFAULT_ROLE_CAPABILITIES.find((item) => item.role === role)!).filter(Boolean);
    }, [roleCapabilities]);

    const handleAccountField = (id: string, source: 'profile' | 'legacy', field: keyof AccessAccount, value: string | number | null) => {
        setAccounts((current) => current.map((account) => {
            if (account.id !== id || account.source !== source) return account;
            return { ...account, [field]: value };
        }));
    };

    const handleSaveAccount = (account: AccessAccount) => {
        setMessage('');
        startTransition(async () => {
            const result = await updateAccessAccount({
                id: account.id,
                source: account.source,
                email: account.email,
                username: account.username,
                first_name: account.first_name,
                last_name: account.last_name,
                role: account.role,
                retail_crm_manager_id: account.retail_crm_manager_id,
            });

            if (!result.success) {
                setMessage(result.message || 'Не удалось сохранить аккаунт.');
                return;
            }

            setMessage(result.message || `Права аккаунта ${account.username || account.email || account.id} сохранены.`);
            router.refresh();
        });
    };

    const handleCreateAccount = () => {
        setMessage('');
        startTransition(async () => {
            const result = await createAccessAccount({
                ...newAccount,
                retail_crm_manager_id: newAccount.retail_crm_manager_id ? Number(newAccount.retail_crm_manager_id) : null,
            });

            if (!result.success) {
                setMessage(result.message || 'Не удалось создать аккаунт.');
                return;
            }

            setMessage(result.message || 'Новый аккаунт создан.');
            setNewAccount({ accountType: 'legacy', email: '', username: '', password: '', first_name: '', last_name: '', role: 'manager', retail_crm_manager_id: '' });
            router.refresh();
        });
    };

    const handleRouteRoleToggle = (prefix: string, role: AppRole) => {
        setRouteRules((current) => current.map((rule) => rule.prefix === prefix
            ? { ...rule, allowed: rule.allowed.includes(role) ? rule.allowed.filter((item) => item !== role) : [...rule.allowed, role] }
            : rule));
    };

    const handleRoleCapabilityField = <K extends keyof RoleCapabilityProfile>(role: AppRole, field: K, value: RoleCapabilityProfile[K]) => {
        setRoleCapabilities((current) => current.map((item) => item.role === role ? { ...item, [field]: value } : item));
    };

    const handleSaveRoleCapabilities = () => {
        setMessage('');
        startTransition(async () => {
            const result = await saveRoleCapabilities(roleCapabilities);

            if (!result.success) {
                if (result.errorType === 'TABLE_MISSING') {
                    setShowSqlGuide(true);
                }
                setMessage(result.message || 'Не удалось сохранить бизнес-права ролей.');
                return;
            }

            setMessage(result.message || 'Бизнес-права ролей сохранены.');
            router.refresh();
        });
    };

    const handleSaveRouteRules = () => {
        setMessage('');
        startTransition(async () => {
            const result = await saveRoutePermissions(routeRules.map((rule) => ({ prefix: rule.prefix, allowed: rule.allowed })));

            if (!result.success) {
                if (result.errorType === 'TABLE_MISSING') {
                    setShowSqlGuide(true);
                }
                setMessage(result.message || 'Не удалось сохранить матрицу прав.');
                return;
            }

            setMessage(result.message || 'Матрица прав сохранена.');
            router.refresh();
        });
    };

    return (
        <div className="max-w-7xl px-2 md:px-0 space-y-5">
            <div>
                <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight mb-1">Доступы и права</h1>
                <p className="text-sm md:text-base text-gray-500">Управление аккаунтами, ролями, бизнес-допусками и маршрутной матрицей доступа.</p>
            </div>

            {message && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">{message}</div>}

            {showSqlGuide && (
                <div className="rounded-3xl border-2 border-amber-200 bg-amber-50 p-5">
                    <h2 className="text-lg font-black text-amber-900 mb-2">Нужны таблицы для сохранения прав</h2>
                    <p className="text-sm text-amber-800 mb-3">Примени миграции для таблиц access_route_rules и access_role_capabilities, после этого будут сохраняться и доступы к разделам, и бизнес-права ролей.</p>
                    <pre className="overflow-x-auto rounded-2xl border border-amber-200 bg-white p-3 text-[10px] text-gray-800">{`CREATE TABLE IF NOT EXISTS public.access_route_rules (
    prefix TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    allowed_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin']::public.app_role[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_role_capabilities (
    role public.app_role PRIMARY KEY,
    data_scope TEXT NOT NULL DEFAULT 'own',
    edit_scope TEXT NOT NULL DEFAULT 'own',
    can_view_analytics BOOLEAN NOT NULL DEFAULT false,
    can_view_audit BOOLEAN NOT NULL DEFAULT false,
    can_view_reactivation BOOLEAN NOT NULL DEFAULT false,
    can_view_settings BOOLEAN NOT NULL DEFAULT false,
    can_manage_users BOOLEAN NOT NULL DEFAULT false,
    can_run_bulk_operations BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`}</pre>
                </div>
            )}

            <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-xl shadow-gray-100 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-black text-gray-900 mb-1">Бизнес-права ролей</h2>
                        <p className="text-sm text-gray-500">Здесь настраивается смысл роли: чьи данные она видит, что редактирует и какие рабочие блоки ей доступны. Это отдельный уровень прав, не равный просто доступу к URL.</p>
                    </div>
                    <button onClick={handleSaveRoleCapabilities} disabled={isPending} className="rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Сохранить роли</button>
                </div>

                <div className="overflow-x-auto">
                    <div className="min-w-[980px] space-y-2">
                        <div className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2 px-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                            <div>Параметр</div>
                            {orderedRoleCapabilities.map((item) => <div key={item.role} className="text-center">{ROLE_LABELS[item.role]}</div>)}
                        </div>

                        <div className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2 items-center">
                            <div className="text-sm font-semibold text-gray-700">Чьи данные видит</div>
                            {orderedRoleCapabilities.map((item) => (
                                <select key={item.role} value={item.dataScope} onChange={(event) => handleRoleCapabilityField(item.role, 'dataScope', event.target.value as RoleCapabilityProfile['dataScope'])} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                    {Object.entries(DATA_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            ))}
                        </div>

                        <div className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2 items-center">
                            <div className="text-sm font-semibold text-gray-700">Что редактирует</div>
                            {orderedRoleCapabilities.map((item) => (
                                <select key={item.role} value={item.editScope} onChange={(event) => handleRoleCapabilityField(item.role, 'editScope', event.target.value as RoleCapabilityProfile['editScope'])} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                    {Object.entries(EDIT_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            ))}
                        </div>

                        {[
                            ['canViewAnalytics', 'Доступ к аналитике'],
                            ['canViewAudit', 'Доступ к аудиту ОКК'],
                            ['canViewReactivation', 'Доступ к реактивации'],
                            ['canViewSettings', 'Доступ к настройкам'],
                            ['canManageUsers', 'Управление пользователями и ролями'],
                            ['canRunBulkOperations', 'Массовые операции'],
                        ].map(([field, label]) => (
                            <div key={field} className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2 items-center">
                                <div className="text-sm font-semibold text-gray-700">{label}</div>
                                {orderedRoleCapabilities.map((item) => (
                                    <label key={item.role} className="flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                                        <input type="checkbox" checked={Boolean(item[field as keyof RoleCapabilityProfile])} onChange={(event) => handleRoleCapabilityField(item.role, field as keyof RoleCapabilityProfile, event.target.checked as never)} aria-label={`${label} — ${ROLE_LABELS[item.role]}`} />
                                    </label>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.65fr] gap-4">
                <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-xl shadow-gray-100">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                        <div>
                            <h2 className="text-lg font-black text-gray-900">Все аккаунты</h2>
                            <p className="text-sm text-gray-500">Редактирование ролей, логинов и привязки к RetailCRM-менеджеру.</p>
                        </div>
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по логину, email, ФИО, роли" className="w-full md:w-72 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-500" />
                    </div>

                    <div className="space-y-3 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
                        {filteredAccounts.map((account) => (
                            <div key={`${account.source}:${account.id}`} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3.5">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-black text-gray-900">{account.username || account.email || 'Без имени'}</h3>
                                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 ring-1 ring-gray-200">{ACCOUNT_SOURCE_LABELS[account.source]}</span>
                                    </div>
                                    <button onClick={() => handleSaveAccount(account)} disabled={isPending} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Сохранить</button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                                    <div className="md:col-span-3">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Логин</label>
                                        <input value={account.username || ''} onChange={(event) => handleAccountField(account.id, account.source, 'username', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Email</label>
                                        <input value={account.email || ''} onChange={(event) => handleAccountField(account.id, account.source, 'email', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" disabled={account.source === 'legacy'} />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Роль</label>
                                        <select value={account.role} onChange={(event) => handleAccountField(account.id, account.source, 'role', event.target.value as AppRole)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                                            {APP_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                                        </select>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Имя</label>
                                        <input value={account.first_name || ''} onChange={(event) => handleAccountField(account.id, account.source, 'first_name', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Фамилия</label>
                                        <input value={account.last_name || ''} onChange={(event) => handleAccountField(account.id, account.source, 'last_name', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-12">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Привязка к менеджеру RetailCRM</label>
                                        <select value={account.retail_crm_manager_id || ''} onChange={(event) => handleAccountField(account.id, account.source, 'retail_crm_manager_id', event.target.value ? Number(event.target.value) : null)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" disabled={account.role !== 'manager'}>
                                            <option value="">Без привязки</option>
                                            {initialManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.label}{manager.active ? '' : ' (не активен)'}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-xl shadow-gray-100">
                        <h2 className="text-lg font-black text-gray-900 mb-1">Новый аккаунт</h2>
                        <p className="text-sm text-gray-500 mb-4">Можно создать основной аккаунт по email или локальный аккаунт по логину.</p>

                        <div className="grid grid-cols-1 gap-2.5">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Тип</label>
                                <select value={newAccount.accountType} onChange={(event) => setNewAccount((current) => ({ ...current, accountType: event.target.value as 'profile' | 'legacy' }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                    <option value="legacy">Локальный аккаунт</option>
                                    <option value="profile">Основной аккаунт</option>
                                </select>
                            </div>
                            {newAccount.accountType === 'profile' && (
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Email</label>
                                    <input value={newAccount.email} onChange={(event) => setNewAccount((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                                </div>
                            )}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Логин</label>
                                <input value={newAccount.username} onChange={(event) => setNewAccount((current) => ({ ...current, username: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Пароль</label>
                                <input type="password" value={newAccount.password} onChange={(event) => setNewAccount((current) => ({ ...current, password: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <input value={newAccount.first_name} onChange={(event) => setNewAccount((current) => ({ ...current, first_name: event.target.value }))} placeholder="Имя" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                                <input value={newAccount.last_name} onChange={(event) => setNewAccount((current) => ({ ...current, last_name: event.target.value }))} placeholder="Фамилия" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <select value={newAccount.role} onChange={(event) => setNewAccount((current) => ({ ...current, role: event.target.value as AppRole }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                    {APP_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                                </select>
                                <select value={newAccount.retail_crm_manager_id} onChange={(event) => setNewAccount((current) => ({ ...current, retail_crm_manager_id: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" disabled={newAccount.role !== 'manager'}>
                                    <option value="">Без привязки</option>
                                    {initialManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.label}</option>)}
                                </select>
                            </div>
                            <button onClick={handleCreateAccount} disabled={isPending} className="rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Создать аккаунт</button>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-xl shadow-gray-100">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div>
                                <h2 className="text-lg font-black text-gray-900">Доступ к разделам</h2>
                                <p className="text-sm text-gray-500">Здесь настраивается только вход в разделы и API. Права на просмотр чужих данных и уровень редактирования регулируются бизнес-логикой системы.</p>
                            </div>
                            <button onClick={handleSaveRouteRules} disabled={isPending} className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Сохранить права</button>
                        </div>

                        <div className="space-y-3 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
                            {Object.entries(groupedRules).map(([category, rules]) => (
                                <div key={category} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3.5">
                                    <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-500 mb-2.5">{category}</h3>
                                    <div className="space-y-2.5">
                                        <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_88px_88px] gap-1.5 px-1 pb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                                            <div>Раздел</div>
                                            <div className="text-center">Админ</div>
                                            <div className="text-center">РОП</div>
                                            <div className="text-center">ОКК</div>
                                            <div className="text-center">Мен. ОП</div>
                                        </div>
                                        {rules.map((rule) => (
                                            <div key={rule.prefix} className="rounded-2xl bg-white p-3 ring-1 ring-gray-100">
                                                <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_88px_88px] gap-1.5 items-start">
                                                    <div className="min-w-0 pr-2">
                                                        <div className="text-sm font-black text-gray-900 leading-tight">{rule.label}</div>
                                                        <div className="text-xs text-gray-400 mt-0.5">{rule.prefix}</div>
                                                        {rule.description && <div className="mt-1 text-xs text-gray-500 leading-snug">{rule.description}</div>}
                                                    </div>
                                                    {ROLE_DISPLAY_ORDER.map((role) => (
                                                        <label key={role} className="flex h-full min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-2 py-2 text-sm text-gray-700">
                                                            <input type="checkbox" checked={rule.allowed.includes(role)} onChange={() => handleRouteRoleToggle(rule.prefix, role)} aria-label={`${ROLE_LABELS[role]} — ${rule.label}`} />
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}