/**
 * Запись разговора для списка звонков. Вся логика — в lib/calls/recording-proxy.
 */
import { serveCallRecording } from '@/lib/calls/recording-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    return serveCallRecording(request);
}
