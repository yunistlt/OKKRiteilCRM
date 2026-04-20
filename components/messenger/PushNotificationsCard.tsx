'use client';

import { useEffect, useState } from 'react';
import { getMessengerErrorMessage } from '@/lib/messenger/error';
import {
    clearCurrentPushSubscription,
    getCurrentPushEndpoint,
    reconcileCurrentPushSubscription,
} from '@/lib/messenger/push-client';
import type { MessengerChat, MessengerPushSubscriptionSettings, MessengerPushSubscriptionSummary } from './types';

export default function PushNotificationsCard({ selectedChatId, selectedChatType }: { selectedChatId: string | null; selectedChatType?: MessengerChat['type'] }) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'enabled' | 'unsupported' | 'not-configured'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [subscriptions, setSubscriptions] = useState<MessengerPushSubscriptionSummary[]>([]);
    const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
    const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
    const [pushConfig, setPushConfig] = useState<{ canSubscribe: boolean; canDispatch: boolean; configError: string | null } | null>(null);

    const loadPushConfig = async () => {
        const response = await fetch('/api/messenger/push-config');
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || 'Не удалось загрузить конфигурацию push');
        }

        const data = await response.json();
        setVapidPublicKey(typeof data.publicKey === 'string' && data.publicKey.length > 0 ? data.publicKey : null);
        setPushConfig({
            canSubscribe: Boolean(data.canSubscribe),
            canDispatch: Boolean(data.canDispatch),
            configError: typeof data.configError === 'string' && data.configError.length > 0 ? data.configError : null,
        });

        return {
            publicKey: typeof data.publicKey === 'string' && data.publicKey.length > 0 ? data.publicKey : null,
            canSubscribe: Boolean(data.canSubscribe),
            canDispatch: Boolean(data.canDispatch),
            configError: typeof data.configError === 'string' && data.configError.length > 0 ? data.configError : null,
        };
    };

    const loadSubscriptions = async () => {
        try {
            const response = await fetch('/api/messenger/push-subscriptions');
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || 'Не удалось загрузить push-подписки');
            }

            const nextSubscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : [];

            if (typeof data.error === 'string' && data.error.length > 0) {
                setError(data.error);
            }

            setSubscriptions(nextSubscriptions);
            return nextSubscriptions as MessengerPushSubscriptionSummary[];
        } catch (loadError) {
            setError(getMessengerErrorMessage(loadError, 'Не удалось загрузить push-подписки'));
            return [] as MessengerPushSubscriptionSummary[];
        }
    };

    useEffect(() => {
        let cancelled = false;

        const initialize = async () => {
            setError(null);

            if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
                if (!cancelled) {
                    setStatus('unsupported');
                }
                return;
            }

            let config;
            try {
                config = await loadPushConfig();
            } catch (configError) {
                if (!cancelled) {
                    setStatus('idle');
                    setError(getMessengerErrorMessage(configError, 'Не удалось загрузить конфигурацию push'));
                }
                return;
            }

            if (!config.publicKey) {
                const endpoint = await getCurrentPushEndpoint().catch(() => null);
                if (!cancelled) {
                    setCurrentEndpoint(endpoint);
                    setStatus('not-configured');
                    if (config.configError) {
                        setError(config.configError);
                    }
                }
                return;
            }

            const currentSubscriptions = await loadSubscriptions();
            const reconcileResult = await reconcileCurrentPushSubscription({
                vapidPublicKey: config.publicKey,
                subscriptions: currentSubscriptions,
            });

            if (cancelled) {
                return;
            }

            setCurrentEndpoint(reconcileResult.currentEndpoint);
            setStatus(reconcileResult.shouldEnableStatus ? 'enabled' : 'idle');

            if (reconcileResult.didChange) {
                await loadSubscriptions();
            }
        };

        void initialize();

        return () => {
            cancelled = true;
        };
    }, []);

    const updateCurrentSettings = async (nextSettings: MessengerPushSubscriptionSettings) => {
        if (!currentEndpoint) {
            setError('Сначала включите push на этом устройстве');
            return;
        }

        setError(null);
        const response = await fetch('/api/messenger/push-subscriptions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: currentEndpoint,
                settings: nextSettings,
            }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || 'Не удалось обновить настройки push');
        }

        await loadSubscriptions();
    };

    const handleEnablePush = async () => {
        const publicKey = vapidPublicKey || (await loadPushConfig()).publicKey;

        if (!publicKey) {
            setStatus('not-configured');
            setError('VAPID public key не настроен');
            return;
        }

        setError(null);
        setStatus('loading');

        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                setStatus('idle');
                setError('Разрешение на уведомления не выдано');
                return;
            }

            const reconcileResult = await reconcileCurrentPushSubscription({
                vapidPublicKey: publicKey,
                subscriptions,
            });

            setCurrentEndpoint(reconcileResult.currentEndpoint);
            setStatus('enabled');
            await loadSubscriptions();
        } catch (subscriptionError) {
            setStatus('idle');
            setError(getMessengerErrorMessage(subscriptionError, 'Не удалось включить push'));
        }
    };

    const handleDisablePush = async () => {
        setError(null);
        setStatus('loading');

        try {
            await clearCurrentPushSubscription();
            setCurrentEndpoint(null);

            setStatus('idle');
            await loadSubscriptions();
        } catch (unsubscribeError) {
            setStatus('enabled');
            setError(getMessengerErrorMessage(unsubscribeError, 'Не удалось отключить push'));
        }
    };

    const activeSubscription = subscriptions.find((subscription) => subscription.endpoint === currentEndpoint) || subscriptions[0] || null;
    const activeSettings = activeSubscription?.settings || {};
    const mutedChatIds = activeSettings.muted_chat_ids || [];
    const isCurrentChatMuted = selectedChatId ? mutedChatIds.includes(selectedChatId) : false;

    const handleChangeDeliveryMode = async (deliveryMode: NonNullable<MessengerPushSubscriptionSettings['delivery_mode']>) => {
        try {
            await updateCurrentSettings({ delivery_mode: deliveryMode });
        } catch (settingsError) {
            setError(getMessengerErrorMessage(settingsError, 'Не удалось обновить режим доставки'));
        }
    };

    const handleChangePreviewMode = async (previewMode: NonNullable<MessengerPushSubscriptionSettings['preview_mode']>) => {
        try {
            await updateCurrentSettings({ preview_mode: previewMode });
        } catch (settingsError) {
            setError(getMessengerErrorMessage(settingsError, 'Не удалось обновить режим preview'));
        }
    };

    const handleToggleEnabled = async () => {
        try {
            await updateCurrentSettings({ enabled: activeSettings.enabled === false ? true : false });
        } catch (settingsError) {
            setError(getMessengerErrorMessage(settingsError, 'Не удалось обновить статус уведомлений'));
        }
    };

    const handleToggleCurrentChatMute = async () => {
        if (!selectedChatId) {
            return;
        }

        const nextMutedChatIds = isCurrentChatMuted
            ? mutedChatIds.filter((chatId) => chatId !== selectedChatId)
            : [...mutedChatIds, selectedChatId];

        try {
            await updateCurrentSettings({ muted_chat_ids: nextMutedChatIds });
        } catch (settingsError) {
            setError(getMessengerErrorMessage(settingsError, 'Не удалось обновить mute для чата'));
        }
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Push-уведомления</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                        Браузерные уведомления для новых сообщений в мессенджере. Поддерживаются desktop и mobile web при включённом Web Push.
                    </div>
                </div>
                <span className={`self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${status === 'enabled' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {status === 'enabled' ? 'Включено' : status === 'loading' ? 'Обновление...' : 'Не включено'}
                </span>
            </div>

            {activeSubscription && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <div className="font-medium text-slate-800">
                        {activeSubscription.device_label || 'Текущее устройство'}
                    </div>
                    <div className="mt-1 break-words">
                        {activeSubscription.platform || 'Web'}{activeSubscription.browser ? ` / ${activeSubscription.browser}` : ''}
                    </div>
                </div>
            )}

            {activeSubscription && (
                <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Статус доставки</div>
                        <button
                            type="button"
                            onClick={handleToggleEnabled}
                            className={`mt-2 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                                activeSettings.enabled === false
                                    ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            }`}
                        >
                            {activeSettings.enabled === false ? 'Уведомления на паузе' : 'Уведомления активны'}
                        </button>
                    </div>

                    <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Режим доставки</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {[
                                { value: 'all', label: 'Все чаты' },
                                { value: 'direct_only', label: 'Только личные' },
                                { value: 'mentions_only', label: 'Только упоминания' },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => handleChangeDeliveryMode(option.value as NonNullable<MessengerPushSubscriptionSettings['delivery_mode']>)}
                                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                                        (activeSettings.delivery_mode || 'all') === option.value
                                            ? 'bg-slate-900 text-white'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview на lock screen</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {[
                                { value: 'full', label: 'Полный' },
                                { value: 'safe', label: 'Без текста' },
                                { value: 'hidden', label: 'Скрыть всё' },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => handleChangePreviewMode(option.value as NonNullable<MessengerPushSubscriptionSettings['preview_mode']>)}
                                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                                        (activeSettings.preview_mode || 'full') === option.value
                                            ? 'bg-slate-900 text-white'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {selectedChatId && (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            <div className="font-medium text-slate-800">
                                {selectedChatType === 'direct' ? 'Личный чат' : 'Текущий чат'}
                            </div>
                            <button
                                type="button"
                                onClick={handleToggleCurrentChatMute}
                                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:py-1.5"
                            >
                                {isCurrentChatMuted ? 'Снять mute с текущего чата' : 'Mute текущий чат'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {error}
                </div>
            )}

            {(status === 'unsupported' || status === 'not-configured') && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    Push недоступен на этом устройстве, но fallback уже работает: unread в списке чатов, бейдж в header, обновление счётчика по polling и системный app badge там, где браузер его поддерживает.
                </div>
            )}

            {pushConfig && pushConfig.canSubscribe && !pushConfig.canDispatch && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Публичный VAPID ключ доступен, но серверная отправка ещё не настроена: проверьте VAPID_PRIVATE_KEY в Vercel env.
                </div>
            )}

            {pushConfig?.configError && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {pushConfig.configError}
                </div>
            )}

            {status === 'enabled' && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                    Подписка self-heal: после повторного login, локальной очистки browser subscription или рассинхрона клиент автоматически восстанавливает текущее устройство и повторно синхронизирует endpoint с сервером.
                </div>
            )}

            {status === 'unsupported' ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Текущий браузер не поддерживает service worker, notifications или push manager.
                </div>
            ) : status === 'not-configured' ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Push flow готов в коде, но отсутствует VAPID public key в runtime-конфиге.
                </div>
            ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        onClick={handleEnablePush}
                        disabled={status === 'loading' || status === 'enabled'}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-default disabled:bg-slate-300 sm:w-auto"
                    >
                        Включить push
                    </button>
                    <button
                        type="button"
                        onClick={handleDisablePush}
                        disabled={status === 'loading' || status !== 'enabled'}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-50 sm:w-auto"
                    >
                        Отключить
                    </button>
                </div>
            )}
        </div>
    );
}