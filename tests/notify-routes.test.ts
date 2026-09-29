import { describe, it, expect } from 'vitest';
import { NOTIFY_TYPES, NOTIFY_TYPE_BY_CODE, TARGET_NAMES } from '@/lib/notify/catalog';
import { splitForTelegram } from '@/lib/notify/send';

describe('каталог типов уведомлений', () => {
  it('коды уникальны', () => {
    const codes = NOTIFY_TYPES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('у каждого типа есть человеческое название и описание', () => {
    for (const t of NOTIFY_TYPES) {
      expect(t.name.length, t.code).toBeGreaterThan(3);
      expect(t.description.length, t.code).toBeGreaterThan(10);
      expect(TARGET_NAMES[t.target], t.code).toBeTruthy();
    }
  });

  // Правила, названные владельцем: оплаты видит отдел, сбои системы — владелец лично.
  it('оплаты уходят в общий чат отдела', () => {
    expect(NOTIFY_TYPE_BY_CODE.get('payment.received')!.target).toBe('group_sales');
    expect(NOTIFY_TYPE_BY_CODE.get('payment.pending_digest')!.target).toBe('group_sales');
  });

  it('сбои системы уходят владельцу в личку', () => {
    for (const code of ['system.audit_alert', 'system.stt_watchdog', 'system.ai_balance', 'system.crash']) {
      expect(NOTIFY_TYPE_BY_CODE.get(code)!.target, code).toBe('owner_dm');
    }
  });

  it('нарушение регламента продаж — в общий чат', () => {
    expect(NOTIFY_TYPE_BY_CODE.get('quality.rule_violation')!.target).toBe('group_sales');
  });

  it('сводный план дня — в общий чат, подробный — менеджеру в личку', () => {
    expect(NOTIFY_TYPE_BY_CODE.get('sales.plan_daily_group')!.target).toBe('group_sales');
    expect(NOTIFY_TYPE_BY_CODE.get('sales.plan_daily_dm')!.target).toBe('manager_dm');
  });

  it('личные сообщения нельзя перенаправить в общий чат', () => {
    for (const code of ['sales.plan_daily_dm', 'sales.evening_review_dm']) {
      expect(NOTIFY_TYPE_BY_CODE.get(code)!.targetFixed, code).toBe(true);
    }
  });
});

describe('разбиение длинных сообщений', () => {
  it('короткое не режет', () => {
    expect(splitForTelegram('привет')).toEqual(['привет']);
  });

  it('длинное режет по строкам и ничего не теряет', () => {
    const text = Array.from({ length: 500 }, (_, i) => `строка ${i}`).join('\n');
    const parts = splitForTelegram(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('\n')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3900);
  });
});
