'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDefaultPathForRole } from '@/lib/rbac';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                router.push(getDefaultPathForRole(data.user?.role));
                router.refresh(); // Refresh layout to pick up cookies
            } else {
                setError(data.error || 'Ошибка входа');
            }
        } catch (err) {
            setError('Ошибка сети');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 bg-[url('/images/noise.png')]">
            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full mx-4">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gray-900 text-white rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">
                        🔐
                    </div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">Вход в систему</h1>
                    <p className="text-sm font-medium text-gray-400 mt-1 uppercase tracking-widest">OKKRiteil CRM</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                            Логин или email
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-0 transition-all placeholder:text-gray-300 placeholder:font-medium"
                            placeholder="admin@example.com или manager1"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                Пароль
                            </label>
                        </div>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
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
                        {loading ? 'ВХОД...' : 'ВОЙТИ'}
                    </button>

                    <div className="text-center mt-6">
                        <p className="text-[10px] text-gray-400 font-medium">Безопасное соединение</p>
                    </div>
                </form>
            </div>
        </div>
    );
}
