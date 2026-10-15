/**
 * Текст уведомления об оплате обязан совпадать с фактом.
 *
 * Инцидент 15.10.2026: сообщение писало «оплата в CRM ещё не занесена» по всем
 * успешно разнесённым платежам. Причина — признак брали из снимка строки,
 * сделанного ДО разноса; в самой базе отметка к тому моменту уже стояла.
 */
import { describe, it, expect } from 'vitest';
import { buildMessage } from '@/lib/payments/notify';

const row: any = {
    id: 1,
    source: 'tochka',
    status: 'matched',
    amount_kopecks: 26607000,
    payer_name: 'ИП ВАЛИАХМЕТОВ АРТУР РАФИЛОВИЧ',
    payer_inn: '027807543385',
    payment_date: '2026-10-15',
    purpose: 'Оплата по счету №54755 от 09.10.2026 г. за шкаф сушильный',
    matched_order_id: 54755,
    matched_order_number: '54755',
    posted_at: null,
};

describe('сообщение об оплате', () => {
    it('разнесённую оплату называет разнесённой, даже если снимок строки устарел', () => {
        const text = buildMessage(row, false, { posted: true, movedToProduction: true });
        expect(text).toContain('оплата разнесена в заказ ОКК');
        expect(text).not.toContain('не занесена');
    });

    it('без разноса говорит прямо, что оплата не разнесена', () => {
        const text = buildMessage(row, false, { posted: false });
        expect(text).toContain('оплата ещё не разнесена в заказ');
    });

    it('при досылке признак берётся из строки платежа', () => {
        const text = buildMessage({ ...row, posted_at: '2026-10-15T05:27:09Z' }, false, {});
        expect(text).toContain('оплата разнесена в заказ ОКК');
    });

    it('номер заказа ведёт в карточку ОКК, а не в RetailCRM', () => {
        const text = buildMessage(row, false, { posted: true });
        expect(text).toContain('/orders?order=54755');
        expect(text).not.toContain('retailcrm');
    });
});
