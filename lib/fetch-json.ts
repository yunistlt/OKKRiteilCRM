/**
 * Чтение наших JSON-ответов в браузере — с повтором при сбое.
 *
 * Зачем: списки для панели фильтров и карточки (менеджеры, справочники,
 * сферы деятельности) грузились один раз и молча. Один неудачный запрос —
 * площадка перезапустилась, сеть моргнула — и выпадающий список до конца дня
 * показывал «Значений нет»: человек видел не ошибку, а «поле не работает» и
 * писал доработку (Женя Матвеева 23.10.2026 — фильтр «Менеджеры»; Ирина
 * Гордеева — причина отмены; раньше тем же сбоем пропадал фильтр «Город
 * доставки», доработка №38).
 *
 * Повтор короткий и конечный: три попытки с нарастающей паузой. Дальше —
 * ошибка наверх, чтобы вызывающий решил, молчать или сказать человеку.
 */
const DELAYS_MS = [400, 1200, 3000];

export async function fetchJsonRetry<T = any>(url: string, init?: RequestInit): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
            await new Promise((done) => setTimeout(done, DELAYS_MS[attempt - 1]));
        }
        try {
            const res = await fetch(url, init);
            if (!res.ok) throw new Error(`${url}: код ${res.status}`);
            return (await res.json()) as T;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`${url}: ответ не получен`);
}
