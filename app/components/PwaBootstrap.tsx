'use client';

import { useEffect } from 'react';

export default function PwaBootstrap() {
    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        if (!window.isSecureContext && window.location.hostname !== 'localhost') {
            return;
        }

        // Один раз перезагружаем страницу, когда новый воркер берёт управление,
        // чтобы клиент с протухшим кешем сразу получил свежие стили/скрипты.
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) return;
            reloaded = true;
            window.location.reload();
        });

        // Старые воркеры кешировали код приложения «навсегда», и после деплоя
        // интерфейс оставался прежним, пока человек не чистил кеш руками
        // (инцидент 01.10.2026). Выносим мусор сами при каждой загрузке: всё,
        // что не текущий кеш воркера, удаляем.
        if ('caches' in window) {
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys
                            .filter((key) => key !== 'okk-messenger-pwa-v3')
                            .map((key) => caches.delete(key)),
                    ),
                )
                .catch(() => undefined);
        }

        navigator.serviceWorker
            .register('/messenger-sw.js', { scope: '/' })
            .then((registration) => {
                // Принудительно проверяем обновление воркера при каждой загрузке.
                registration.update().catch(() => undefined);
            })
            .catch((error) => {
                console.error('[PWA] Service worker registration failed:', error);
            });
    }, []);

    return null;
}