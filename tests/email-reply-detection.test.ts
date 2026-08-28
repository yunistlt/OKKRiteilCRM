/**
 * Признак «ответ на НАШЕ исходящее» (Катерина). Инцидент 27.08.2026: клиент переслал (Fwd) своё же
 * первое обращение, в цитате была строка «Кому: rop@zmktlt.ru» — письмо ушло в reply_thread,
 * заявка на «РИ Стол для измерения» потеряна (заказа в CRM не появилось).
 */
import { describe, it, expect } from 'vitest';
import { repliesToOurOutbound } from '@/lib/email/classify';

const DOMAIN = 'zmktlt.ru';

describe('repliesToOurOutbound', () => {
    it('Fwd своего же первого обращения («Кому: …@наш-домен») — НЕ переписка', () => {
        const body = [
            '-------- Пересылаемое сообщение --------',
            '27.08.2026, 09:17, Александр Параскевич (a.paraskevich@omegacarparts.ru):',
            'Кому: rop@zmktlt.ru (rop@zmktlt.ru);',
            'Тема: стол для измерения;',
            'добрый день, хотел бы приобрести РИ Стол для измерения ВГХ 900.1200.500',
        ].join('\n');
        expect(repliesToOurOutbound({ bodyText: body }, DOMAIN)).toBe(false);
    });

    it('цитата нашего письма «От: …@наш-домен» — переписка', () => {
        const body = 'Добрый день!\nОт: rop@zmktlt.ru\nТема: КП\n> Ваш запрос актуален?';
        expect(repliesToOurOutbound({ bodyText: body }, DOMAIN)).toBe(true);
    });

    it('цитата «…@наш-домен пишет:» — переписка', () => {
        expect(repliesToOurOutbound({ bodyText: '20.08.2026, rop@zmktlt.ru пишет:\n> КП во вложении' }, DOMAIN)).toBe(true);
    });

    it('заголовок ответа на наш релей — переписка', () => {
        expect(repliesToOurOutbound({ inReplyTo: '<abc@mlgnr.com>' }, DOMAIN)).toBe(true);
    });

    it('холодное письмо без наших следов — не переписка', () => {
        expect(repliesToOurOutbound({ bodyText: 'Добрый день, пришлите КП на шкаф сушильный' }, DOMAIN)).toBe(false);
    });
});
