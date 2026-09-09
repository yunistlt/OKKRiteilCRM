-- Статусы, по которым менеджера не дёргаем.
--
-- Правило владельца: заказ, ушедший в тендер, из рук менеджера вышел. Мы своё
-- сделали — отправили предложение, — и дальше решает заказчик по своим срокам.
-- Единственное осмысленное действие там письмо с уточнением, и грузить этим
-- дневной план нельзя: у менеджера есть заказы, где от него что-то зависит.
--
-- Список в настройке, а не в коде: правила отдела меняются чаще, чем стоит
-- делать деплой.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('plan_excluded_statuses',
     'tender,ozhidanie-vykhoda-tendera,dubl-na-tender,tender-s-dubliruyuschimi-zayavkami,gos-tender,tender-otkaz,ne-vyigrali-tender,tender-vyigran',
     'Статусы, которые не попадают в дневной план: там от менеджера ничего не зависит')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, comment = EXCLUDED.comment;
