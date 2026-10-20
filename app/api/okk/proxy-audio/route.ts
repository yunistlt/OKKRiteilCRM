/**
 * Запись разговора для экрана контроля качества и карточки заказа.
 *
 * Отдельный маршрут остаётся из-за прав: у экранов ОКК свой список ролей.
 * Поведение общее — lib/calls/recording-proxy.
 */
import { serveCallRecording } from '@/lib/calls/recording-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    return serveCallRecording(request);
}
