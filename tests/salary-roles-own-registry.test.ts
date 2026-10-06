/**
 * Схема зарплаты берётся из нашего реестра, а не из групп RetailCRM.
 *
 * Разбор 06.10.2026: в RetailCRM группа менеджеров стала «tes», а наши схемы
 * называются «menedzhery». Совпадения не было — в расчёт не попадал никто, и
 * «Зарплата ОП» за сентябрь писала «засчитанных заявок нет» при 47 заявках.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tables: Record<string, any[]> = {
    salary_scheme: [{ code: 'menedzhery', effective_from: '2026-05-01' }],
    managers: [
        // Группа из RetailCRM со схемой не совпадает.
        { id: 98, first_name: 'Евгения', last_name: 'Матвеева', active: true, raw_data: { groups: [{ code: 'tes', name: 'tes' }] } },
        // Этого в наш реестр ещё не перенесли — у него группа совпадает со схемой.
        { id: 7, first_name: 'Старый', last_name: 'Менеджер', active: true, raw_data: { groups: [{ code: 'menedzhery', name: 'Менеджеры' }] } },
    ],
    salary_manager_comp: [{ manager_id: 98, scheme_code: 'menedzhery', effective_from: '2026-05-01' }],
};

vi.mock('@/utils/supabase', () => {
    const build = (name: string) => {
        const q: any = {
            select: () => q, lte: () => q, eq: () => q, in: () => q,
            order: () => q,
            then: (res: any) => res({ data: tables[name] ?? [], error: null }),
        };
        return q;
    };
    return { supabase: { from: (name: string) => build(name) } };
});

beforeEach(() => vi.clearAllMocks());

describe('роль менеджера в зарплате', () => {
    it('берётся из нашего реестра, даже когда группа в CRM другая', async () => {
        const { resolveManagerRoles } = await import('../lib/salary/roles');
        const roles = await resolveManagerRoles('2026-09-01');

        expect(roles.find((r) => r.managerId === 98)?.resolved).toBe('menedzhery');
    });

    it('без записи в реестре работает прежний путь — по группе CRM', async () => {
        const { resolveManagerRoles } = await import('../lib/salary/roles');
        const roles = await resolveManagerRoles('2026-09-01');

        expect(roles.find((r) => r.managerId === 7)?.resolved).toBe('menedzhery');
    });
});
