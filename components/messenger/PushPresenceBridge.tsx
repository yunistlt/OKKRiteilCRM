'use client';

import { useEffect, useRef } from 'react';

function getTabId() {
    if (typeof window === 'undefined') {
        return 'server';
    }

    const existing = window.sessionStorage.getItem('messenger-push-tab-id');
    if (existing) {
        return existing;
    }

    const nextValue = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    window.sessionStorage.setItem('messenger-push-tab-id', nextValue);
    return nextValue;
}

async function getSubscriptionEndpoint() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return null;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint || null;
}

export default function PushPresenceBridge({ selectedChatId }: { selectedChatId: string | null }) {
    const tabIdRef = useRef<string | null>(null);

    useEffect(() => {
        tabIdRef.current = getTabId();
    }, []);

    useEffect(() => {
        let disposed = false;

        const sendPresence = async (focused: boolean) => {
            const endpoint = await getSubscriptionEndpoint();
            if (!endpoint || disposed) {
                return;
            }

            await fetch('/api/messenger/push-presence', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint,
                    tab_id: tabIdRef.current,
                    chat_id: selectedChatId,
                    page_path: window.location.pathname + window.location.search,
                    page_visible: document.visibilityState === 'visible',
                    focused,
                }),
                keepalive: true,
            }).catch(() => undefined);
        };

        const syncVisibleState = () => {
            void sendPresence(document.hasFocus() && document.visibilityState === 'visible');
        };

        const interval = window.setInterval(syncVisibleState, 25000);
        void syncVisibleState();

        window.addEventListener('focus', syncVisibleState);
        window.addEventListener('blur', syncVisibleState);
        document.addEventListener('visibilitychange', syncVisibleState);

        return () => {
            disposed = true;
            window.clearInterval(interval);
            window.removeEventListener('focus', syncVisibleState);
            window.removeEventListener('blur', syncVisibleState);
            document.removeEventListener('visibilitychange', syncVisibleState);
        };
    }, [selectedChatId]);

    return null;
}