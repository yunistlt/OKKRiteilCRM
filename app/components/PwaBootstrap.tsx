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