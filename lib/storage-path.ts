/**
 * Имена для Supabase Storage.
 *
 * Хранилище принимает в ключе только латиницу, цифры и `._-/`: кириллица даёт
 * «Invalid key» и загрузка падает. А у нас кириллица в двух местах сразу —
 * в именах файлов («претензия.pdf») и в номерах своих заказов («1038А»).
 *
 * Поэтому в ПУТИ кладём латинскую запись, а настоящее имя храним в базе
 * (`file_name`) и отдаём человеку при скачивании.
 */

const RU_TO_LAT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
};

/** Кириллица → латиница, остальное — как есть. */
export function translit(value: string): string {
    return String(value ?? '')
        .split('')
        .map((ch) => {
            const lower = ch.toLowerCase();
            const mapped = RU_TO_LAT[lower];
            if (mapped === undefined) return ch;
            return ch === lower ? mapped : mapped.toUpperCase();
        })
        .join('');
}

/** Безопасный кусок пути: латиница, цифры, точка, дефис и подчёркивание. */
export function safeStorageSegment(value: string, maxLength = 120): string {
    const cleaned = translit(value)
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^[._]+|[._]+$/g, '');
    return (cleaned.slice(-maxLength) || 'file');
}
