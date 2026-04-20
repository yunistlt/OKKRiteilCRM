import { NextResponse } from 'next/server';
import { getMessengerErrorMessage } from '@/lib/messenger/error';

export const dynamic = 'force-dynamic';

function decodeBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(`${normalized}${padding}`, 'base64');
}

function getVapidConfigError(publicKey: string | null, privateKey: string | null, subject: string | null) {
    if (!publicKey) {
        return null;
    }

    try {
        if (decodeBase64Url(publicKey).length !== 65) {
            return 'VAPID public key имеет неверный формат';
        }

        if (privateKey && decodeBase64Url(privateKey).length !== 32) {
            return 'VAPID private key имеет неверный формат';
        }
    } catch {
        return 'VAPID ключи не удалось декодировать';
    }

    if (subject && !subject.startsWith('mailto:') && !subject.startsWith('https://')) {
        return 'VAPID subject должен начинаться с mailto: или https://';
    }

    return null;
}

export async function GET() {
    try {
        const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
        const privateKey = process.env.VAPID_PRIVATE_KEY || null;
        const subject = process.env.VAPID_SUBJECT || null;
        const configError = getVapidConfigError(publicKey, privateKey, subject);
        const canSubscribe = Boolean(publicKey) && !configError;
        const canDispatch = canSubscribe && Boolean(privateKey);

        return NextResponse.json({
            publicKey: canSubscribe ? publicKey : null,
            canSubscribe,
            canDispatch,
            configError,
        });
    } catch (error: unknown) {
        return NextResponse.json({
            error: getMessengerErrorMessage(error, 'Не удалось проверить конфигурацию push'),
        }, { status: 500 });
    }
}