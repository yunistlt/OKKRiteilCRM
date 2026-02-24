import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateHumanNotification } from '@/lib/semantic';
import { sendTelegramNotification } from '@/lib/telegram';

// Vercel Cron will hit this endpoint every 10 minutes
export async function GET(req: Request) {
    // Basic authorization to prevent arbitrary triggers. Vercel automatically sends this header
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Warning: This endpoint should remain accessible during local dev or if no secret is configured
        if (process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
            return new NextResponse('Unauthorized', { status: 401 });
        }
    }

    try {
        // 1. Time Check: Only run between 09:00 and 18:00 MSK (UTC+3)
        // Note: New Date() gets current UTC time on Vercel
        const nowUtc = new Date();
        const moscowHour = (nowUtc.getUTCHours() + 3) % 24;

        if (moscowHour < 9 || moscowHour >= 18) {
            return NextResponse.json({
                status: 'skipped',
                reason: 'outside_working_hours',
                moscow_hour: moscowHour
            });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 2. Queue Logic: Fetch EXACTLY 1 unsent violation from the queue (FIFO)
        const { data: violations, error: fetchError } = await supabase
            .from('okk_violations')
            .select('*')
            .or('telegram_notified.is.null,telegram_notified.eq.false')
            .order('detected_at', { ascending: true }) // Send oldest first
            .limit(1);

        if (fetchError) {
            console.error('[Telegram Cron] Failed to fetch violation:', fetchError);
            return NextResponse.json({ status: 'error', code: 'db_fetch_error' }, { status: 500 });
        }

        if (!violations || violations.length === 0) {
            return NextResponse.json({ status: 'empty', reason: 'no_pending_notifications' });
        }

        const v = violations[0];

        // 3. Prepare Notification
        // Fetch manager details and rule name
        const { data: manager } = await supabase.from('managers').select('first_name, raw_data').eq('id', v.manager_id).single();
        const { data: rule } = await supabase.from('okk_rules').select('name').eq('code', v.rule_code).single();

        const ruleName = rule?.name || v.rule_code;
        const details = v.details?.length > 200 ? v.details.substring(0, 200) + '...' : (v.details || 'Нарушение регламента');

        const managerName = manager?.first_name || '';
        const telegramUsername = manager?.raw_data?.telegram_username || '';
        const persona = Math.random() > 0.5 ? 'anna' : 'igor';

        const aiMessage = await generateHumanNotification(
            managerName,
            v.order_id?.toString() || 'Неизвестен',
            ruleName,
            details,
            telegramUsername,
            persona
        );

        // 4. Send and Mark as Notified
        await sendTelegramNotification(aiMessage);

        const { error: updError } = await supabase
            .from('okk_violations')
            .update({ telegram_notified: true })
            .eq('id', v.id);

        if (updError) {
            console.error('[Telegram Cron] Failed to mark violation as sent:', updError);
            return NextResponse.json({ status: 'error', code: 'db_update_error' }, { status: 500 });
        }

        return NextResponse.json({ status: 'sent', violation_id: v.id, manager: managerName });

    } catch (e: any) {
        console.error('[Telegram Cron] Unexpected Error:', e);
        return NextResponse.json({ status: 'error', message: e.message }, { status: 500 });
    }
}
