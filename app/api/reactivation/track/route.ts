/**
 * GET /api/reactivation/track?id=[LOG_ID]
 * Пиксель отслеживания (Tracking Pixel) для Виктории.
 * Фиксирует факт открытия письма клиентом.
 */

import { NextResponse } from 'next/server';
import { markLogOpenedById } from '@/lib/reactivation-db';

// 1х1 прозрачный GIF пиксель в base64
const PIXEL_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PIXEL_BUFFER = Buffer.from(PIXEL_BASE64, 'base64');

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
        try {
            // Отмечаем прочтение в фоне (не блокируем ответ картинки)
            markLogOpenedById(id).catch(err => {
                console.error('[TrackingPixel] Failed to update log:', id, err);
            });
        } catch (e) {
            console.error('[TrackingPixel] Error:', e);
        }
    }

    // Отдаем пиксель в любом случае
    return new NextResponse(PIXEL_BUFFER, {
        headers: {
            'Content-Type': 'image/gif',
            'Content-Length': PIXEL_BUFFER.length.toString(),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        },
    });
}
