-- Обновление цветов в более сочные и яркие тона
-- Группа 1: Синие/Голубые (Новые, Предварительные) -> #2563EB (Blue 600)
UPDATE statuses SET color = '#2563EB' WHERE color = '#DBEAFE';

-- Группа 2: Красные (Отмены, Отказы) -> #DC2626 (Red 600)
UPDATE statuses SET color = '#DC2626' WHERE color = '#FEE2E2';

-- Группа 3: Желтые (В просчете, На согласовании) -> #D97706 (Amber 600)
UPDATE statuses SET color = '#D97706' WHERE color = '#FEF3C7';

-- Группа 4: Голубые (Доставка, Отгрузка) -> #0891B2 (Cyan 600)
UPDATE statuses SET color = '#0891B2' WHERE color = '#E0E7FF';

-- Группа 5: Зеленые (Выполнено, Успех) -> #16A34A (Green 600)
UPDATE statuses SET color = '#16A34A' WHERE color = '#DCFCE7';

-- Группа 6: Фиолетовые (Производство) -> #9333EA (Purple 600)
UPDATE statuses SET color = '#9333EA' WHERE color = '#F3E8FF';
