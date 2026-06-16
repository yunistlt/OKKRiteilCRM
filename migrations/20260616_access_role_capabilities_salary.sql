-- Добавляет бизнес-право «Доступ к зарплате» в матрицу ролей.
-- Аддитивная миграция: новая колонка с дефолтом, обратносовместимо.

ALTER TABLE public.access_role_capabilities
    ADD COLUMN IF NOT EXISTS can_view_salary BOOLEAN NOT NULL DEFAULT false;

-- Дефолтные значения по ролям: полный доступ к зарплате у админа и РОП.
UPDATE public.access_role_capabilities SET can_view_salary = true  WHERE role = 'admin';
UPDATE public.access_role_capabilities SET can_view_salary = true  WHERE role = 'rop';
UPDATE public.access_role_capabilities SET can_view_salary = false WHERE role IN ('manager', 'okk', 'demo');
