const PUBLIC_STORAGE_MARKER = '/storage/v1/object/public/chat-attachments/';
const SIGNED_STORAGE_MARKER = '/storage/v1/object/sign/chat-attachments/';

export function normalizeMessengerAvatarPath(value?: string | null) {
    if (!value) {
        return null;
    }

    if (value.startsWith('avatars/')) {
        return value;
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
        const signedIndex = value.indexOf(SIGNED_STORAGE_MARKER);
        if (signedIndex >= 0) {
            const rawPath = value.slice(signedIndex + SIGNED_STORAGE_MARKER.length).split('?')[0];
            return decodeURIComponent(rawPath);
        }

        const publicIndex = value.indexOf(PUBLIC_STORAGE_MARKER);
        if (publicIndex >= 0) {
            const rawPath = value.slice(publicIndex + PUBLIC_STORAGE_MARKER.length).split('?')[0];
            return decodeURIComponent(rawPath);
        }

        return null;
    }

    if (value.includes('chat-attachments/')) {
        return value.split('chat-attachments/')[1] || null;
    }

    return null;
}

export function resolveMessengerAvatarSrc(value?: string | null) {
    if (!value) {
        return null;
    }

    const normalizedPath = normalizeMessengerAvatarPath(value);
    if (normalizedPath) {
        return `/api/messenger/avatar?path=${encodeURIComponent(normalizedPath)}`;
    }

    return value;
}