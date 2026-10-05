/**
 * Ссылка на поиск по сайту — когда карточки товара там уже нет (архив).
 * Отдельным файлом, чтобы её можно было звать из интерфейса, не тянув в
 * браузерный бандл клиент базы каталога.
 */
export function siteSearchUrl(name: string): string {
    return `https://zmktlt.ru/search/?query=${encodeURIComponent(String(name ?? '').slice(0, 120))}`;
}
