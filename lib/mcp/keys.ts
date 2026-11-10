import { createHash, randomBytes } from 'crypto';
import { supabase } from '@/utils/supabase';

// Ключи коннектора Claude.
//
// Ключ выдаётся сотруднику один раз и в базе не хранится — только его SHA-256.
// Поэтому потерянный ключ нельзя «посмотреть»: его отзывают и выдают новый.
// Проверка — поиск по хешу: сравнения строк с самим ключом в коде нет вовсе.

export type McpKey = {
    id: number;
    employeeId: string | null;
    employeeName: string;
    closedSections: string[];
};

const KEY_PREFIX = 'okk_';

export function generateKey(): string {
    return KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function hashKey(key: string): string {
    return createHash('sha256').update(key.trim()).digest('hex');
}

/**
 * Ключ принимаем и заголовком X-Api-Key, и как Bearer-токен: в формах
 * подключения у разных клиентов Claude поле называется по-разному.
 */
export function keyFromRequest(req: Request): string {
    const direct = (req.headers.get('x-api-key') ?? '').trim();
    if (direct) return direct;
    const auth = (req.headers.get('authorization') ?? '').trim();
    return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';
}

// «Когда пользовались» обновляем не чаще раза в минуту на ключ: писать в базу
// на каждый вызов ради одной даты незачем.
const lastTouch = new Map<number, number>();
const TOUCH_EVERY_MS = 60_000;

/** Находит действующий ключ. Отозванный и неизвестный неотличимы — оба null. */
export async function authenticate(req: Request): Promise<McpKey | null> {
    const key = keyFromRequest(req);
    if (!key.startsWith(KEY_PREFIX)) return null;

    const { data, error } = await supabase
        .from('mcp_keys')
        .select('id, employee_id, employee_name, closed_sections')
        .eq('key_hash', hashKey(key))
        .is('revoked_at', null)
        .maybeSingle();
    if (error || !data) return null;

    const now = Date.now();
    if (now - (lastTouch.get(data.id) ?? 0) > TOUCH_EVERY_MS) {
        lastTouch.set(data.id, now);
        void supabase
            .from('mcp_keys')
            .update({ last_used_at: new Date(now).toISOString() })
            .eq('id', data.id)
            .then(() => null, () => null);
    }

    return {
        id: Number(data.id),
        employeeId: data.employee_id ?? null,
        employeeName: String(data.employee_name ?? ''),
        closedSections: Array.isArray(data.closed_sections) ? data.closed_sections : [],
    };
}

/** Строка журнала. Сбой записи журнала не должен ронять сам ответ. */
export async function logCall(
    key: McpKey,
    tool: string,
    params: unknown,
    rowCount: number,
    durationMs: number,
    error: string | null,
): Promise<void> {
    await supabase
        .from('mcp_call_log')
        .insert({
            key_id: key.id,
            employee_name: key.employeeName,
            tool,
            params: params ?? {},
            row_count: rowCount,
            duration_ms: durationMs,
            error,
        })
        .then(() => null, () => null);
}
