-- Починка флага «рабочий статус».
--
-- Флагов было два и они расходились. status_settings.is_working размечен верно:
-- 13 статусов, где сделка действительно в руках менеджера. statuses.is_working
-- стоял у 54 из 62 — включая «Купили в другом месте», «Пропала необходимость» и
-- всю группу «Отменён». По нему сумма «в работе» выходила 7,4 млрд.
--
-- Второй флаг виден в настройках ОКК и на него смотрит человек, поэтому чиним:
-- приводим к status_settings, а не наоборот. Синк статусов из CRM это поле не
-- трогает (app/api/sync/statuses пишет только имя, группу, активность и цвет),
-- так что починка переживёт следующую выгрузку.
UPDATE public.statuses s
   SET is_working = coalesce(ss.is_working, false),
       updated_at = now()
  FROM public.status_settings ss
 WHERE ss.code = s.code
   AND coalesce(s.is_working, false) IS DISTINCT FROM coalesce(ss.is_working, false);

-- Статусы, которых в status_settings нет вовсе, рабочими быть не могут:
-- разметку ведёт человек, и отсутствие записи — это «не размечен», а не «да».
UPDATE public.statuses s
   SET is_working = false, updated_at = now()
 WHERE s.is_working
   AND NOT EXISTS (SELECT 1 FROM public.status_settings ss WHERE ss.code = s.code);

-- «Согласование отмены» — 1121 заказ на 580 млн, две трети портфеля — по словам
-- владельца это заказы, которые уже неактуальны по тем или иным причинам.
-- Рабочим такой статус быть не должен: он раздувает воронку и прячет то, с чем
-- действительно можно работать.
UPDATE public.status_settings SET is_working = false, updated_at = now()
 WHERE code = 'soglasovanie-otmeny';
UPDATE public.statuses SET is_working = false, updated_at = now()
 WHERE code = 'soglasovanie-otmeny';
