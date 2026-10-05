// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Техническая интеграция с API Телфин и генерация токенов.
import { supabase } from '@/utils/supabase';

const TELPHIN_FETCH_TIMEOUT_MS = 15000;

export async function fetchTelphin(url: string, init?: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELPHIN_FETCH_TIMEOUT_MS);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`Telphin request timeout after ${TELPHIN_FETCH_TIMEOUT_MS}ms`);
        }
        throw new Error(`Telphin network error: ${error?.message || 'Unknown fetch error'}`);
    } finally {
        clearTimeout(timeout);
    }
}

export async function getTelphinToken() {
    const TELPHIN_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
    const TELPHIN_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

    if (!TELPHIN_KEY || !TELPHIN_SECRET) {
        throw new Error('Telphin config missing (KEY/SECRET)');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_KEY);
    params.append('client_secret', TELPHIN_SECRET);
    params.append('scope', 'all');

    const res = await fetchTelphin('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin Auth Failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.access_token;
}

const TELPHIN_API = 'https://apiproxy.telphin.ru/api/ver1.0';

// Числовой client_id/extension_id авторизованного аккаунта. Токен их не содержит —
// берём из self-эндпоинта GET /user/ (Get current user information). Кэшируем на процесс.
let cachedIdentity: { clientId: string; extensionId: string | null } | null = null;
export async function getTelphinIdentity(token: string): Promise<{ clientId: string; extensionId: string | null }> {
    if (cachedIdentity) return cachedIdentity;
    const res = await fetchTelphin(`${TELPHIN_API}/user/`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Telphin get user failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const user = Array.isArray(data) ? data[0] : data;
    const clientId = user?.client_id;
    if (!clientId) throw new Error(`Telphin client_id not found in /user/ response: ${JSON.stringify(data).slice(0, 300)}`);
    cachedIdentity = { clientId: String(clientId), extensionId: user?.extension_id ? String(user.extension_id) : null };
    return cachedIdentity;
}

// Внутренний extension_id по короткому номеру добавочного (напр. 105 → 44xxxxx).
const extensionIdCache = new Map<string, string>();
export async function getTelphinExtensionId(token: string, clientId: string, extNumber: string): Promise<string> {
    const cacheKey = `${clientId}:${extNumber}`;
    const cached = extensionIdCache.get(cacheKey);
    if (cached) return cached;
    const res = await fetchTelphin(`${TELPHIN_API}/client/${clientId}/extension/`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Telphin get extensions failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data : (data?.extensions ?? []);
    if (!list.length) throw new Error('Telphin extension list empty');
    const num = String(extNumber);
    // Короткий номер лежит суффиксом в name формата "12037*105" (поля number нет). Матчим суффикс
    // после '*', плюс label/id; если не нашли — любой валидный extension (инициатор вторичен, звонит src_num).
    const shortOf = (name: any) => String(name ?? '').split('*').pop();
    const match = list.find((e: any) =>
        shortOf(e.name) === num || [e.label, e.id, e.caller_id_name].map((v: any) => String(v)).includes(num)
    ) ?? list[0];
    const id = match?.id ?? match?.extension_id;
    if (!id) throw new Error(`Telphin extension id missing in list item: ${JSON.stringify(match).slice(0, 200)}`);
    const resolved = String(id);
    extensionIdCache.set(cacheKey, resolved);
    return resolved;
}

/**
 * Зарегистрирован ли аппарат менеджера в Телфине.
 *
 * Звонок из интерфейса идёт в два плеча: сначала Телфин звонит на добавочный
 * менеджера, тот поднимает трубку, и только потом набирается клиент. Если
 * софтфон не запущен, первое плечо звонит в пустоту — а интерфейс показывал
 * «набираем номер» и молчал о причине (поймано 30.09.2026).
 */
export async function isExtensionOnline(extensionNumber: string): Promise<boolean> {
    try {
        const token = await getTelphinToken();
        const { clientId } = await getTelphinIdentity(token);
        const extensionId = await getTelphinExtensionId(token, clientId, extensionNumber);
        const res = await fetchTelphin(`${TELPHIN_API}/extension/${extensionId}/registration/`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        return Boolean(data?.registered);
    } catch {
        // Не смогли проверить — не мешаем звонить: вдруг дело в самой проверке.
        return true;
    }
}

/**
 * Номер клиента в международном формате для набора: «+7…», «+375…».
 * Российские 8XXXXXXXXXX и 10-значные приводим к +7, остальное оставляем как
 * есть, добавив плюс — страну за клиента не угадываем.
 */
function toE164(raw: string): string {
    const cleaned = String(raw ?? '').replace(/[^\d+]/g, '');
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (!digitsOnly) return cleaned;
    if (digitsOnly.length === 11 && digitsOnly.startsWith('8')) return `+7${digitsOnly.slice(1)}`;
    if (digitsOnly.length === 10) return `+7${digitsOnly}`;
    return `+${digitsOnly}`;
}

export async function initiateMakeCall(params: {
    extensionId: string;   // короткий номер добавочного-инициатора (напр. 105)
    source: string;        // первое плечо — очередь ОП (напр. 200)
    destination: string;   // второе плечо — телефон клиента
}) {
    const token = await getTelphinToken();
    const { clientId, extensionId: defaultExtensionId } = await getTelphinIdentity(token);
    // Внутренний extension_id инициатора (по номеру 105); если не нашли — extension самого аккаунта из /user/.
    let extensionId: string;
    try {
        extensionId = await getTelphinExtensionId(token, clientId, params.extensionId);
    } catch (e) {
        if (!defaultExtensionId) throw e;
        extensionId = defaultExtensionId;
    }

    // POST /api/ver1.0/extension/{extension_id}/callback/
    // src_num (массив) — первое плечо, dst_num — второе плечо (клиент).
    // Номера — только цифры (Телфин не принимает '+').
    //
    // Кому какой номер показывается — не очевидно и стоило путаницы (Ирина
    // 02.10.2026: «я набираю номер клиента, а звоню нам»):
    //  * `caller_id_number` / `caller_id_name` видит ПЕРВОЕ плечо, то есть сам
    //    менеджер на своём аппарате. Туда ставим номер КЛИЕНТА — так менеджер
    //    видит, с кем его соединяют, и может перезвонить сам. Это же советует
    //    документация Телфина, когда первое плечо — внутренний номер.
    //  * `src_ani` видит КЛИЕНТ — туда идёт наш городской номер, иначе Телфин
    //    подставит номер транка.
    const digits = (s: string) => String(s).replace(/[^\d]/g, '');
    const companyNumber = process.env.TELPHIN_CALLBACK_CALLER_ID || '74993504490';
    /**
     * Номер клиента уходит в международном виде, с плюсом.
     *
     * Ирина 02.10.2026: «не набирает, говорит неправильно набран номер, а в
     * RetailCRM набирает» — звонок был белорусскому клиенту. В журнале Телфина
     * видно почему: вызовы с `+375…`, `+7…` проходят, а те же цифры без плюса
     * отбиваются. Телфин без плюса не понимает, что номер международный.
     */
    const clientNumber = toE164(params.destination);
    const res = await fetchTelphin(`${TELPHIN_API}/extension/${extensionId}/callback/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            src_num: [digits(params.source)],
            dst_num: clientNumber,
            // В caller_id кладём только цифры: это подпись для аппарата
            // менеджера, а не номер для набора.
            caller_id_number: digits(clientNumber),
            caller_id_name: digits(clientNumber),
            src_ani: companyNumber
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin Callback Failed: ${res.status} ${text} [ext=${extensionId} src=${params.source} dst=${params.destination}]`);
    }

    const data = await res.json();
    return {
        callId: data.call_id,
        success: true
    };
}

/**
 * Инициирует исходящий звонок менеджера клиенту
 * @param managerId ID менеджера (из managers.id)
 * @param targetPhone номер клиента для звонка
 * @returns { callId, success }
 */
export async function initiateManagerOutgoingCall(params: {
    managerId: number;
    targetPhone: string;
}) {
    // Получить добавочный номер менеджера
    const { data: manager, error } = await supabase
        .from('managers')
        .select('telphin_extension')
        .eq('id', params.managerId)
        .single();

    if (error || !manager?.telphin_extension) {
        throw new Error('У менеджера не указан добавочный номер в Телфине — позвонить нельзя');
    }

    const managerExtension = manager.telphin_extension;

    // Аппарат не в сети — звонок уйдёт в пустоту. Честно говорим об этом,
    // вместо того чтобы показывать «набираем номер».
    if (!(await isExtensionOnline(managerExtension))) {
        throw new Error(
            `Ваш телефон (добавочный ${managerExtension}) не в сети — звонок не дойдёт. `
            + 'Запустите Linphone и дождитесь, пока он подключится.',
        );
    }

    // Первое плечо — аппарат САМОГО менеджера, а не очередь ОП: звонок поднимает
    // тот, кто нажал кнопку. Очередь (TELPHIN_CALLBACK_SOURCE) здесь не при делах —
    // она подняла бы весь отдел разом, это сценарий обратного звонка Ловца Лидов.
    return initiateMakeCall({
        extensionId: managerExtension,
        source: managerExtension,
        destination: params.targetPhone,
    });
}
