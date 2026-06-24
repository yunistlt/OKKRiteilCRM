'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token') || '';

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('Пароль должен быть не короче 6 символов');
            return;
        }
        if (password !== confirm) {
            setError('Пароли не совпадают');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                setDone(true);
                setTimeout(() => router.push('/login'), 1800);
            } else {
                setError(data.error || 'Не удалось сменить пароль');
            }
        } catch {
            setError('Ошибка сети');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="space-y-4">
                <div className="bg-red-50 text-red-600 text-sm font-bold px-4 py-4 rounded-xl border border-red-100 text-center">
                    Ссылка некорректна — в ней нет токена. Запросите смену пароля заново.
                </div>
                <Link
                    href="/forgot-password"
                    className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-blue-200 text-center"
                >
                    ЗАПРОСИТЬ ССЫЛКУ
                </Link>
            </div>
        );
    }

    if (done) {
        return (
            <div className="bg-green-50 text-green-700 text-sm font-bold px-4 py-4 rounded-xl border border-green-100 text-center">
                Пароль обновлён. Перенаправляем на страницу входа…
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                    Новый пароль
                </label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-0 transition-all"
                    placeholder="••••••••"
                />
            </div>
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                    Повторите пароль
                </label>
                <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-0 transition-all"
                    placeholder="••••••••"
                />
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 text-xs font-bold px-4 py-3 rounded-xl border border-red-100 text-center">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-blue-200 mt-2"
            >
                {loading ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ ПАРОЛЬ'}
            </button>
        </form>
    );
}

export default function ResetPasswordPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 bg-[url('/images/noise.png')]">
            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full mx-4">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gray-900 text-white rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">
                        🔐
                    </div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">Новый пароль</h1>
                    <p className="text-sm font-medium text-gray-400 mt-1 uppercase tracking-widest">OKKRiteil CRM</p>
                </div>

                <Suspense fallback={<div className="text-center text-gray-400 text-sm">Загрузка…</div>}>
                    <ResetPasswordForm />
                </Suspense>
            </div>
        </div>
    );
}
