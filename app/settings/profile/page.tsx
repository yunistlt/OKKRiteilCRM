'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { prepareAvatarFileForUpload } from '@/lib/messenger/avatar-client';
import { resolveMessengerAvatarSrc } from '@/lib/messenger/avatar';
import { uploadFileToSignedStorageUrl } from '@/lib/supabase-browser';

export default function ProfilePage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const isManagerBound = user?.role === 'manager' && !!user?.retail_crm_manager_id;

    useEffect(() => {
        fetch('/api/auth/profile')
            .then(r => r.json())
            .then(data => {
                if (data.user) {
                    const u = data.user;
                    setUser(u);
                    setFirstName(u.first_name || '');
                    setLastName(u.last_name || '');
                    setUsername(u.username || '');
                    setAvatarUrl(u.avatar_url || '');
                }
            })
            .catch(() => setError('Не удалось загрузить профиль'))
            .finally(() => setLoading(false));
    }, []);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setUploading(true);
        setError('');
        try {
            const file = await prepareAvatarFileForUpload(selectedFile);

            const preparation = await fetch('/api/auth/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_name: file.name,
                    file_type: file.type,
                    file_size: file.size,
                }),
            });

            const payload = await preparation.json().catch(() => null);
            if (!preparation.ok) {
                throw new Error(payload?.error || 'Не удалось подготовить загрузку аватара');
            }

            await uploadFileToSignedStorageUrl({
                bucket: 'chat-attachments',
                filePath: payload.file_path,
                token: payload.token,
                file,
                upsert: true,
            });

            setAvatarUrl(payload.file_path);
        } catch (err: any) {
            setError('Ошибка загрузки аватара: ' + (err.message || ''));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSave = async () => {
        setError('');
        setSuccess('');

        if (password && password !== confirmPassword) {
            setError('Пароли не совпадают');
            return;
        }
        if (password && password.length < 4) {
            setError('Пароль должен быть не менее 4 символов');
            return;
        }

        setSaving(true);
        try {
            const body: Record<string, any> = {
                username,
                avatar_url: avatarUrl,
            };
            if (!isManagerBound) {
                body.first_name = firstName;
                body.last_name = lastName;
            }
            if (password) body.password = password;

            const res = await fetch('/api/auth/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');
            setSuccess('Профиль успешно обновлён');
            setPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
    };

    const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || username?.[0]?.toUpperCase() || '?';

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                Загрузка профиля...
            </div>
        );
    }

    return (
        <div className="w-full px-4 py-6 md:px-6 md:py-8">
            <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight mb-2">Профиль</h1>
            <p className="text-gray-500 mb-8 text-base">Управление личными данными и безопасностью аккаунта.</p>

            {/* Avatar + Name Card */}
            <div className="bg-white border border-gray-100 rounded-3xl shadow-xl shadow-gray-100 p-8 mb-6">
                <div className="flex items-center gap-6 mb-8">
                    {/* Avatar */}
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-200">
                            {avatarUrl ? (
                                <img src={resolveMessengerAvatarSrc(avatarUrl) || avatarUrl} alt="Аватар" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-3xl font-black text-white">{initials}</span>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            {uploading ? (
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            )}
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </div>

                    <div>
                        <p className="text-xl font-black text-gray-900">
                            {firstName || lastName ? `${firstName} ${lastName}`.trim() : username}
                        </p>
                        <p className="text-sm text-gray-400 font-medium mt-0.5">@{username}</p>
                        <span className="mt-2 inline-block px-3 py-1 text-xs font-black uppercase tracking-wider rounded-full bg-blue-50 text-blue-600">
                            {user?.role || 'admin'}
                        </span>
                    </div>
                </div>

                {isManagerBound && (
                    <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                        Имя и фамилия синхронизируются из справочника RetailCRM. В ОКК для менеджера редактируются только логин, пароль и аватар.
                    </div>
                )}

                {/* Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Имя</label>
                        <input
                            type="text"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            placeholder="Иван"
                            disabled={isManagerBound}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Фамилия</label>
                        <input
                            type="text"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            placeholder="Иванов"
                            disabled={isManagerBound}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Логин</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Password Card */}
            <div className="bg-white border border-gray-100 rounded-3xl shadow-xl shadow-gray-100 p-8 mb-6">
                <h2 className="text-lg font-black text-gray-900 mb-1">Смена пароля</h2>
                <p className="text-sm text-gray-400 mb-5">Оставьте поля пустыми, если не хотите менять пароль.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Новый пароль</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Повторите пароль</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Feedback */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 p-4 bg-green-50 border border-green-100 rounded-2xl text-sm text-green-600 font-medium">
                    ✓ {success}
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-4">
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-6 py-3 text-sm font-black text-red-500 hover:text-red-700 hover:bg-red-50 rounded-2xl transition-all border border-red-100"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Выйти из аккаунта
                </button>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-2xl text-sm font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-60"
                >
                    {saving ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                    Сохранить изменения
                </button>
            </div>
        </div>
    );
}
