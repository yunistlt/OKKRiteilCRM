/**
 * Магазин для заявок: если настроенный пропал из справочника RetailCRM,
 * заявка всё равно заводится — в запасном, и об этом сообщают владельцу.
 * Инцидент 30.09.2026: заявки с почты не создавались четыре часа.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
    db: {
        config: { lead_site: 'zmktlt-ru', lead_site_fallback: 'ooo-zmk-tochka-bank' } as any,
        sites: [
            { item_code: 'zmktlt-ru-admin', item_name: 'ООО «ПОБТ»', active: true },
            { item_code: 'ooo-zmk-tochka-bank', item_name: 'ООО «ЗМК»', active: true },
        ] as any[],
    },
}));

vi.mock('@/utils/supabase', () => {
    const chain = (rows: any[], single: any) => {
        const c: any = {
            eq: () => c,
            maybeSingle: async () => ({ data: single, error: null }),
            then: (res: any) => res({ data: rows, error: null }),
        };
        return c;
    };
    return {
        supabase: {
            from(table: string) {
                return {
                    select: () => {
                        if (table === 'email_intake_config') return chain([], db.config);
                        if (table === 'retailcrm_dictionaries') return chain(db.sites, null);
                        return chain([], null);
                    },
                    upsert: async () => ({ error: null }),
                };
            },
        },
    };
});

vi.mock('@/lib/notify/send', () => ({ sendNotification: async () => ({ sent: true }) }));

import { resolveLeadSite } from '@/lib/retailcrm/lead-site';

beforeEach(() => {
    db.config = { lead_site: 'zmktlt-ru', lead_site_fallback: 'ooo-zmk-tochka-bank' };
    db.sites = [
        { item_code: 'zmktlt-ru-admin', item_name: 'ООО «ПОБТ»', active: true },
        { item_code: 'ooo-zmk-tochka-bank', item_name: 'ООО «ЗМК»', active: true },
    ];
});

describe('выбор магазина для заявки', () => {
    it('пропавший магазин заменяется запасным и объясняет причину', async () => {
        const choice = await resolveLeadSite();
        expect(choice.site).toBe('ooo-zmk-tochka-bank');
        expect(choice.substituted).toBe(true);
        expect(choice.reason).toContain('пропал из справочника');
    });

    it('настроенный магазин на месте — ничего не подменяем', async () => {
        db.config.lead_site = 'zmktlt-ru-admin';
        const choice = await resolveLeadSite();
        expect(choice.site).toBe('zmktlt-ru-admin');
        expect(choice.substituted).toBe(false);
    });

    it('запасной тоже пропал — берём любой действующий, но заявку не теряем', async () => {
        db.config.lead_site_fallback = 'ooo-zmk-vtb';
        const choice = await resolveLeadSite();
        expect(choice.site).toBe('zmktlt-ru-admin');
        expect(choice.substituted).toBe(true);
    });

    it('справочник пуст — идём как настроено, не выдумывая', async () => {
        db.sites = [];
        const choice = await resolveLeadSite();
        expect(choice.site).toBe('zmktlt-ru');
        expect(choice.substituted).toBe(false);
    });

    it('неактивный магазин не годится', async () => {
        db.sites = [
            { item_code: 'zmktlt-ru', item_name: 'старый', active: false },
            { item_code: 'zmktlt-ru-admin', item_name: 'ООО «ПОБТ»', active: true },
        ];
        const choice = await resolveLeadSite();
        expect(choice.site).toBe('zmktlt-ru-admin');
        expect(choice.substituted).toBe(true);
    });
});
