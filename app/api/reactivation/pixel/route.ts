import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

/**
 * GET /api/reactivation/pixel?id=UUID
 * Трекинг прочтения письма (пиксель)
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
        try {
            // Отмечаем прочтение в базе данных
            const { error } = await supabase
                .from('ai_outreach_logs')
                .update({ 
                    opened_at: new Date().toISOString() 
                })
                .eq('id', id)
                .is('opened_at', null); // Только если еще не открыто

            if (error) console.error('[Pixel] DB Update Error:', error);
            else console.log(`[Pixel] Log ${id} marked as OPENED`);
        } catch (e) {
            console.error('[Pixel] Error:', e);
        }
    }

    // Возвращаем прозрачный 1х1 GIF
    const buffer = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );

    return new NextResponse(buffer, {
        headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        },
    });
}
