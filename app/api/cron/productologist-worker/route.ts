import { NextRequest, NextResponse } from 'next/server';
import { Productologist } from '@/lib/productologist';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Исследование занимает время

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

/**
 * GET /api/cron/productologist-worker
 * Фоновый воркер ЕЛЕНЫ (Продуктолога)
 * Находит новые товары и изучает их (ищет на сайте, парсит тех-данные)
 */
export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);
        console.log('[ElenaWorker] Scanning for new products...');
        
        // 1. Находим товары, которые еще не изучены
        const pendingProducts = await Productologist.findUnstudiedProducts(3); // По 3 за раз
        
        if (pendingProducts.length === 0) {
            return NextResponse.json({ success: true, message: 'Все товары уже изучены!' });
        }

        const reports: any[] = [];

        // 2. Изучаем каждый продукт
        for (const name of pendingProducts) {
            const report = await Productologist.studyProduct(name);
            if (report) {
                await Productologist.saveToKnowledgeBase(report);
                reports.push({ name, status: 'studied', category: report.category });
            } else {
                reports.push({ name, status: 'failed' });
            }
        }

        return NextResponse.json({
            success: true,
            processed: reports.length,
            details: reports
        });

    } catch (error: any) {
        console.error('[ElenaWorker] Error:', error);
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json({ error: error.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
