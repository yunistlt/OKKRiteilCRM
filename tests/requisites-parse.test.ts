import { describe, expect, it } from 'vitest';
import { parseRequisitesFromText } from '@/lib/own-crm/requisites-lookup';

/** Карточка предприятия, как её присылают клиенты. */
const CARD = `
Карточка предприятия
Полное наименование: Общество с ограниченной ответственностью «Служба комплексного снабжения»
ИНН 3812129130
КПП 381201001
ОГРН 1103850021681
Юридический адрес: 664082, г. Иркутск, мкр Университетский 13/15
Банк: ООО «Банк Точка»
Р/с 40702810320000044910
К/с 30101810745374525104
БИК 044525104
Генеральный директор Кучерова Ольга Васильевна
`;

describe('реквизиты из карточки предприятия', () => {
    const parsed = parseRequisitesFromText(CARD);

    it('читает номера', () => {
        expect(parsed.inn).toBe('3812129130');
        expect(parsed.kpp).toBe('381201001');
        expect(parsed.ogrn).toBe('1103850021681');
    });

    it('читает банковские реквизиты', () => {
        expect(parsed.bankAccount).toBe('40702810320000044910');
        expect(parsed.corrAccount).toBe('30101810745374525104');
        expect(parsed.bik).toBe('044525104');
    });

    it('читает подписанта', () => {
        expect(parsed.signerName).toBe('Кучерова Ольга Васильевна');
        expect(parsed.signerTitle?.toLowerCase()).toContain('директор');
    });

    it('не выдумывает того, чего в карточке нет', () => {
        const empty = parseRequisitesFromText('Просто письмо без реквизитов');
        expect(empty.inn).toBeNull();
        expect(empty.bankAccount).toBeNull();
    });
});
