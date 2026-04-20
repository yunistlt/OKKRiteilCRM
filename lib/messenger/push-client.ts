import type { MessengerPushSubscriptionSummary } from '@/components/messenger/types';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(normalized);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

export function getBrowserLabel() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Edg/')) return 'Edge';
    if (userAgent.includes('Chrome/')) return 'Chrome';
    if (userAgent.includes('Firefox/')) return 'Firefox';
    if (userAgent.includes('Safari/')) return 'Safari';
    return 'Unknown';
}

export function getPlatformLabel() {
    const userAgent = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS';
    if (/Android/i.test(userAgent)) return 'Android';
    if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
    if (/Windows/i.test(userAgent)) return 'Windows';
    return 'Web';
}

function supportsBrowserPush() {
    return typeof window !== 'undefined'
        && 'Notification' in window
        && 'serviceWorker' in navigator
        && 'PushManager' in window;
}

export async function getCurrentPushSubscription() {
    if (!supportsBrowserPush()) {
        return null;
    }

    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
}

export async function getCurrentPushEndpoint() {
    const subscription = await getCurrentPushSubscription();
    return subscription?.endpoint || null;
}

export async function revokePushEndpoint(endpoint: string) {
    await fetch('/api/messenger/push-subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
    });
}

export async function upsertPushSubscription(subscription: PushSubscription, permissionState: NotificationPermission = Notification.permission) {
    const serializedSubscription = subscription.toJSON();
    const response = await fetch('/api/messenger/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            endpoint: serializedSubscription.endpoint,
            expirationTime: serializedSubscription.expirationTime ?? null,
            keys: serializedSubscription.keys,
            platform: getPlatformLabel(),
            browser: getBrowserLabel(),
            device_label: `${getPlatformLabel()} / ${getBrowserLabel()}`,
            user_agent: navigator.userAgent,
            permission_state: permissionState,
            chat_scope: { messenger: true },
            settings: { enabled: true },
        }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Не удалось сохранить push-подписку');
    }

    return serializedSubscription.endpoint || null;
}

export async function ensurePushSubscription(vapidPublicKey: string) {
    const registration = await navigator.serviceWorker.ready;
    const currentSubscription = await registration.pushManager.getSubscription();

    if (currentSubscription) {
        return currentSubscription;
    }

    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
}

export async function clearCurrentPushSubscription() {
    const currentSubscription = await getCurrentPushSubscription();
    if (!currentSubscription) {
        return null;
    }

    await revokePushEndpoint(currentSubscription.endpoint);
    await currentSubscription.unsubscribe().catch(() => undefined);
    return currentSubscription.endpoint;
}

export async function reconcileCurrentPushSubscription(params: {
    vapidPublicKey?: string;
    subscriptions?: MessengerPushSubscriptionSummary[];
}) {
    if (!supportsBrowserPush()) {
        return { currentEndpoint: null, shouldEnableStatus: false, didChange: false };
    }

    const permissionState = Notification.permission;

    if (permissionState !== 'granted') {
        const revokedEndpoint = await clearCurrentPushSubscription();
        return {
            currentEndpoint: null,
            shouldEnableStatus: false,
            didChange: Boolean(revokedEndpoint),
        };
    }

    if (!params.vapidPublicKey) {
        return { currentEndpoint: await getCurrentPushEndpoint(), shouldEnableStatus: false, didChange: false };
    }

    const subscription = await ensurePushSubscription(params.vapidPublicKey);
    const endpoint = subscription.endpoint;
    const existingServerSubscription = params.subscriptions?.find((item) => item.endpoint === endpoint);

    await upsertPushSubscription(subscription, permissionState);

    return {
        currentEndpoint: endpoint,
        shouldEnableStatus: true,
        didChange: !existingServerSubscription || existingServerSubscription.permission_state !== 'granted',
    };
}