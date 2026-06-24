'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            setMessage(data.message || 'Если такой email зарегистрирован, мы отправили на него ссылку.');
            setDone(true);
        } catch {
            setMessage('Если такой email зарегистрирован, мы отправили на него ссылку.');
            setDone(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 bg-[url('/images/noise.png')]">
            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full mx-4">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gray-900 text-white rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">
                        🔑
                    </div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">Восстановление пароля</h1>
                    <p className="text-sm font-medium text-gray-400 mt-1 uppercase tracking-widest">OKKRiteil CRM</p>
                </div>

                {done ? (
                    <div className="space-y-4">
                        <div className="bg-green-50 text-green-700 text-sm font-bold px-4 py-4 rounded-xl border border-green-100 text-center">
                            {message}
                        </div>
                        <Link
                            href="/login"
                            className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-blue-200 text-center"
                        >
                            ВЕРНУТЬСЯ КО ВХОДУ
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <p className="text-sm text-gray-500 text-center">
                            Введите email, привязанный к вашему аккаунту — мы пришлём ссылку для смены пароля.
                        </p>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-0 transition-all placeholder:text-gray-300 placeholder:font-medium"
                                placeholder="you@example.com"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-blue-200 mt-2"
                        >
                            {loading ? 'ОТПРАВКА...' : 'ОТПРАВИТЬ ССЫЛКУ'}
                        </button>

                        <div className="text-center mt-6">
                            <Link href="/login" className="text-xs text-gray-400 hover:text-gray-600 font-bold">
                                ← Вернуться ко входу
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
