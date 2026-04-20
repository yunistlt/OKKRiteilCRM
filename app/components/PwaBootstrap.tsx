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

        navigator.serviceWorker.register('/messenger-sw.js', { scope: '/' }).catch((error) => {
            console.error('[PWA] Service worker registration failed:', error);
        });
    }, []);

    return null;
}