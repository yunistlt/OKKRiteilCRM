-- Обновление ограничения ролей для локальных аккаунтов (таблица public.users)
-- Чтобы разрешить использование всех системных ролей (admin, manager, okk, rop, demo) в локальной таблице
DO $$
BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
        -- Удаляем старое жесткое ограничение
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
        
        -- Добавляем новое ограничение, включающее новые роли
        ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'okk', 'rop', 'demo'));
    END IF;
END $$;
