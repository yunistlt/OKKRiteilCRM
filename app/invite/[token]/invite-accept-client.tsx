'use client';

import { useState, useTransition } from 'react';
import type { AppRole } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/access-control';
import { acceptInvitation } from '../actions';

type Props = {
    token: string;
    role: AppRole;
    firstName: string | null;
    lastName: string | null;
    note: string | null;
};

export default function InviteAcceptClient({ token, role, firstName, lastName, note }: Props) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isPending, startTransition] = useTransition();

    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        startTransition(async () => {
            const result = await acceptInvitation({ token, username, password });
            if (!result.success) {
                setError(result.message || 'Не удалось создать аккаунт.');
                return;
            }
            window.location.href = result.redirectTo || '/';
        });
    };

    return (
        <div className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center px-4 py-10">
            <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 shadow-xl shadow-gray-100">
                <h1 className="text-2xl font-black text-gray-900 mb-1">Приглашение в систему</h1>
                <p className="text-sm text-gray-500 mb-5">
                    {fullName ? `${fullName}, придумайте` : 'Придумайте'} логин и пароль — аккаунт будет создан с ролью{' '}
                    <span className="font-bold text-gray-700">«{ROLE_LABELS[role]}»</span> и всеми её правами.
                </p>

                {note && <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">{note}</div>}

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Логин</label>
                        <input
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoComplete="username"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Пароль</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="new-password"
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-blue-500"
                            required
                        />
                    </div>

                    {error && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

                    <button
                        type="submit"
                        disabled={isPending}
                        className="w-full rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                    >
                        {isPending ? 'Создаём аккаунт…' : 'Создать аккаунт и войти'}
                    </button>
                </form>
            </div>
        </div>
    );
}
