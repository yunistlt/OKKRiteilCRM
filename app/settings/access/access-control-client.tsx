'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import type { RouteRule } from '@/lib/rbac';
import { APP_ROLES } from '@/lib/rbac';
import { AccessAccount, AccessManagerOption, createAccessAccount, saveRoutePermissions, updateAccessAccount } from './actions';

const ROLE_LABELS: Record<AppRole, string> = {
    admin: 'Админ',
    okk: 'ОКК',
    rop: 'РОП',
    manager: 'Менеджер',
};

type Props = {
    initialAccounts: AccessAccount[];
    initialManagers: AccessManagerOption[];
    initialRouteRules: RouteRule[];
    routeRulesTableReady: boolean;
};

export default function AccessControlClient({ initialAccounts, initialManagers, initialRouteRules, routeRulesTableReady }: Props) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [accounts, setAccounts] = useState(initialAccounts);
    const [routeRules, setRouteRules] = useState(initialRouteRules);
    const [search, setSearch] = useState('');
    const [message, setMessage] = useState('');
    const [showSqlGuide, setShowSqlGuide] = useState(!routeRulesTableReady);
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

    const handleAccountField = (id: string, source: 'profile' | 'legacy', field: keyof AccessAccount, value: string | number | null) => {
        setAccounts((current) => current.map((account) => {
            if (account.id !== id || account.source !== source) return account;
            return { ...account, [field]: value };
        }));
    };

    const handleSaveAccount = (account: AccessAccount) => {
        setMessage('');
        startTransition(async () => {
            try {
                await updateAccessAccount({
                    id: account.id,
                    source: account.source,
                    email: account.email,
                    username: account.username,
                    first_name: account.first_name,
                    last_name: account.last_name,
                    role: account.role,
                    retail_crm_manager_id: account.retail_crm_manager_id,
                });
                setMessage(`Права аккаунта ${account.username || account.email || account.id} сохранены.`);
                router.refresh();
            } catch (error: any) {
                setMessage(error.message || 'Не удалось сохранить аккаунт.');
            }
        });
    };

    const handleCreateAccount = () => {
        setMessage('');
        startTransition(async () => {
            try {
                await createAccessAccount({
                    ...newAccount,
                    retail_crm_manager_id: newAccount.retail_crm_manager_id ? Number(newAccount.retail_crm_manager_id) : null,
                });
                setMessage('Новый аккаунт создан.');
                setNewAccount({ accountType: 'legacy', email: '', username: '', password: '', first_name: '', last_name: '', role: 'manager', retail_crm_manager_id: '' });
                router.refresh();
            } catch (error: any) {
                setMessage(error.message || 'Не удалось создать аккаунт.');
            }
        });
    };

    const handleRouteRoleToggle = (prefix: string, role: AppRole) => {
        setRouteRules((current) => current.map((rule) => rule.prefix === prefix
            ? { ...rule, allowed: rule.allowed.includes(role) ? rule.allowed.filter((item) => item !== role) : [...rule.allowed, role] }
            : rule));
    };

    const handleSaveRouteRules = () => {
        setMessage('');
        startTransition(async () => {
            try {
                const result = await saveRoutePermissions(routeRules.map((rule) => ({ prefix: rule.prefix, allowed: rule.allowed })));
                if (!result.success && result.errorType === 'TABLE_MISSING') {
                    setShowSqlGuide(true);
                    setMessage('Для сохранения матрицы прав нужно сначала применить SQL-миграцию.');
                    return;
                }
                setMessage('Матрица прав сохранена.');
                router.refresh();
            } catch (error: any) {
                setMessage(error.message || 'Не удалось сохранить матрицу прав.');
            }
        });
    };

    return (
        <div className="max-w-7xl px-2 md:px-0 space-y-8">
            <div>
                <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight mb-2">Доступы и права</h1>
                <p className="text-gray-500 text-base md:text-lg">Управление аккаунтами, ролями и маршрутной матрицей доступа.</p>
            </div>

            {message && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}

            {showSqlGuide && (
                <div className="rounded-3xl border-2 border-amber-200 bg-amber-50 p-6">
                    <h2 className="text-xl font-black text-amber-900 mb-3">Нужна таблица для editable-прав</h2>
                    <p className="text-sm text-amber-800 mb-4">Примени миграцию для таблицы access_route_rules, после этого матрица прав начнёт сохраняться.</p>
                    <pre className="overflow-x-auto rounded-2xl border border-amber-200 bg-white p-4 text-[11px] text-gray-800">{`CREATE TABLE IF NOT EXISTS public.access_route_rules (
    prefix TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    allowed_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin']::public.app_role[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`}</pre>
                </div>
            )}

            <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
                <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-100">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
                        <div>
                            <h2 className="text-xl font-black text-gray-900">Все аккаунты</h2>
                            <p className="text-sm text-gray-500">Редактирование ролей, логинов и привязки к RetailCRM-менеджеру.</p>
                        </div>
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по логину, email, ФИО, роли" className="w-full md:w-80 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition-all focus:border-blue-500" />
                    </div>

                    <div className="space-y-4 max-h-[760px] overflow-y-auto pr-1">
                        {filteredAccounts.map((account) => (
                            <div key={`${account.source}:${account.id}`} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                                <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Логин</label>
                                        <input value={account.username || ''} onChange={(event) => handleAccountField(account.id, account.source, 'username', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Email</label>
                                        <input value={account.email || ''} onChange={(event) => handleAccountField(account.id, account.source, 'email', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" disabled={account.source === 'legacy'} />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Роль</label>
                                        <select value={account.role} onChange={(event) => handleAccountField(account.id, account.source, 'role', event.target.value as AppRole)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                                            {APP_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <button onClick={() => handleSaveAccount(account)} disabled={isPending} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Сохранить</button>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Имя</label>
                                        <input value={account.first_name || ''} onChange={(event) => handleAccountField(account.id, account.source, 'first_name', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Фамилия</label>
                                        <input value={account.last_name || ''} onChange={(event) => handleAccountField(account.id, account.source, 'last_name', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Привязка к менеджеру RetailCRM</label>
                                        <select value={account.retail_crm_manager_id || ''} onChange={(event) => handleAccountField(account.id, account.source, 'retail_crm_manager_id', event.target.value ? Number(event.target.value) : null)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" disabled={account.role !== 'manager'}>
                                            <option value="">Без привязки</option>
                                            {initialManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.label}{manager.active ? '' : ' (не активен)'}</option>)}
                                        </select>
                                    </div>
                                    <div className="md:col-span-2 flex items-center gap-2 text-xs text-gray-500">
                                        <span className="rounded-full bg-white px-3 py-1 font-bold uppercase tracking-wider text-gray-500 ring-1 ring-gray-200">{account.source === 'profile' ? 'Supabase Auth' : 'Legacy'}</span>
                                        <span>ID: {account.id}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-100">
                        <h2 className="text-xl font-black text-gray-900 mb-2">Новый аккаунт</h2>
                        <p className="text-sm text-gray-500 mb-5">Можно создать полноценный Supabase-аккаунт по email или legacy-аккаунт по логину.</p>

                        <div className="grid grid-cols-1 gap-3">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Тип</label>
                                <select value={newAccount.accountType} onChange={(event) => setNewAccount((current) => ({ ...current, accountType: event.target.value as 'profile' | 'legacy' }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                    <option value="legacy">Legacy</option>
                                    <option value="profile">Supabase Auth</option>
                                </select>
                            </div>
                            {newAccount.accountType === 'profile' && (
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Email</label>
                                    <input value={newAccount.email} onChange={(event) => setNewAccount((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                                </div>
                            )}
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Логин</label>
                                <input value={newAccount.username} onChange={(event) => setNewAccount((current) => ({ ...current, username: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Пароль</label>
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
                            <button onClick={handleCreateAccount} disabled={isPending} className="rounded-2xl bg-gray-900 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Создать аккаунт</button>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-100">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <h2 className="text-xl font-black text-gray-900">Матрица прав</h2>
                                <p className="text-sm text-gray-500">Какие роли имеют доступ к каким разделам и API.</p>
                            </div>
                            <button onClick={handleSaveRouteRules} disabled={isPending} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Сохранить права</button>
                        </div>

                        <div className="space-y-5 max-h-[760px] overflow-y-auto pr-1">
                            {Object.entries(groupedRules).map(([category, rules]) => (
                                <div key={category} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                                    <h3 className="text-sm font-black uppercase tracking-wider text-gray-500 mb-3">{category}</h3>
                                    <div className="space-y-3">
                                        {rules.map((rule) => (
                                            <div key={rule.prefix} className="rounded-2xl bg-white p-3 ring-1 ring-gray-100">
                                                <div className="mb-2">
                                                    <div className="text-sm font-black text-gray-900">{rule.label}</div>
                                                    <div className="text-xs text-gray-400">{rule.prefix}</div>
                                                    {rule.description && <div className="mt-1 text-xs text-gray-500">{rule.description}</div>}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {APP_ROLES.map((role) => (
                                                        <label key={role} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                                                            <input type="checkbox" checked={rule.allowed.includes(role)} onChange={() => handleRouteRoleToggle(rule.prefix, role)} />
                                                            <span>{ROLE_LABELS[role]}</span>
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