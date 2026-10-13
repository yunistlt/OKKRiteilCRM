-- ============================================================================
-- Роль «Бухгалтер»: полный просмотр денег без права их менять.
--
-- Главбуху (Анна Шатрова) нужно видеть ведомость зарплаты, платежи, заказы и
-- документы, но не нужно закрывать период, пересчитывать его и править ставки
-- мотивации — это действия, которые меняют людям деньги. До этого у неё была
-- роль администратора, где все эти кнопки есть.
--
-- Роль живёт в ТРЁХ местах, и все три надо держать в согласии (иначе человек
-- заходит, но упирается в ограничение базы):
--   1) перечисление app_role — им типизированы access_role_capabilities,
--      profiles, access_invitations;
--   2) CHECK на users.role — там роль лежит текстом;
--   3) код: AppRole и правила маршрутов в lib/rbac.ts.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'buhgalter';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
    role = ANY (ARRAY[
        'admin'::text, 'manager'::text, 'okk'::text, 'rop'::text,
        'jurist'::text, 'demo'::text, 'logistics'::text, 'logistics_view'::text,
        'buhgalter'::text
    ])
);
