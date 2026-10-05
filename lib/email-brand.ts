/**
 * Фирменное оформление писем: логотип сверху, подпись компании снизу.
 *
 * Решение владельца 05.10.2026: «все документы должны быть брендированы, и
 * письма тоже». Раньше письмо уходило голым текстом — клиент видел сообщение
 * без признаков того, что это завод, с которым он работает.
 *
 * Логотип вкладываем в письмо картинкой (cid), а не ссылкой: ссылку на
 * картинку почтовые клиенты блокируют по умолчанию, и шапка оставалась пустым
 * прямоугольником.
 */
import { BRAND, LOGO_DATA_URL } from '@/lib/brand';

export const LOGO_CID = 'zmk-logo';

/** Вложение с логотипом — его ждёт `<img src="cid:zmk-logo">` в письме. */
export function brandAttachment(): { filename: string; content: Buffer; cid: string; contentType: string } {
    return {
        filename: 'zmk.jpg',
        content: Buffer.from(LOGO_DATA_URL.split(',')[1] ?? '', 'base64'),
        cid: LOGO_CID,
        contentType: 'image/jpeg',
    };
}

/**
 * Оборачивает тело письма в фирменный бланк. Уже обёрнутое письмо не трогаем:
 * шаблоны, которые сами рисуют вёрстку, должны остаться как есть.
 */
export function wrapInBrand(html: string): string {
    if (!html || html.includes(`cid:${LOGO_CID}`)) return html;

    return `
<div style="font-family: Arial, Helvetica, sans-serif; color: ${BRAND.ink}; font-size: 14px; line-height: 1.5;">
  <div style="border-top: 4px solid ${BRAND.blue}; padding-top: 12px;">
    <img src="cid:${LOGO_CID}" alt="ЗМК" style="height: 38px;">
  </div>
  <div style="margin: 16px 0;">${html}</div>
  <div style="border-top: 1px solid #e5e7eb; padding-top: 10px; color: #6b7280; font-size: 12px;">
    Завод металлических конструкций · <a href="https://zmktlt.ru" style="color: ${BRAND.blue};">zmktlt.ru</a> · +7 499 350-44-90
  </div>
</div>`.trim();
}
