/**
 * Сводка ошибок владельцу. Раз в час: что сломалось и где.
 *
 * До 30.09.2026 ошибки копились молча — журнала `error_logs` не существовало в
 * базе, а сбои ботов были видны только из таблиц. Из-за этого о поломке
 * магазина RetailCRM узнали от менеджеров спустя четыре часа.
 */
import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { sendErrorDigest } from '@/lib/error-digest';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
    if (!isCronHeaderAuthorized(request)) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    try {
        const result = await sendErrorDigest();
        return NextResponse.json({ ok: true, ...result });
    } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
    }
}
