import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
    const privateKeyConfigured = Boolean(process.env.VAPID_PRIVATE_KEY);

    return NextResponse.json({
        publicKey,
        canSubscribe: Boolean(publicKey),
        canDispatch: Boolean(publicKey && privateKeyConfigured),
    });
}