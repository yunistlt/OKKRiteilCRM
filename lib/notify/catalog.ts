/**
 * Каталог типов сообщений и их адресатов.
 *
 * Зачем: раньше «куда слать» было размазано по коду каждого отправителя (payments,
 * бот-РОП, аудит системы, звонки). Правка одного места ломала другое — оплаты уехали
 * из общего чата в личку владельцу вместе с правкой маршрутизации (инцидент 28.09.2026).
 * Теперь адресат — свойство ТИПА сообщения, а не места в коде.
 *
 * Здесь только каталог (какие типы бывают и куда шлём по умолчанию). Фактический
 * адрес берётся из таблицы notification_routes — её правит человек в интерфейсе,
 * см. lib/notify/route.ts.
 */

/** Куда шлём. Конкретный chat_id разрешается в route.ts — здесь только роль адресата. */
export type NotifyTarget =
  | 'group_sales' // общий чат отдела продаж (рабочие события, видят все)
  | 'owner_dm' // личка владельца (техника и деньги, не для отдела)
  | 'manager_dm' // личка конкретного менеджера (персональные задачи)
  | 'accounting' // бухгалтерия (ведомости, документы)
  | 'project_stolyarka' // чат проекта «Столярка»
  | 'project_consulting'; // чат проекта «ПО/Консалтинг»

export const TARGET_NAMES: Record<NotifyTarget, string> = {
  group_sales: 'Общий чат отдела продаж',
  owner_dm: 'Владельцу в личку',
  manager_dm: 'Менеджеру в личку',
  accounting: 'Бухгалтерия',
  project_stolyarka: 'Чат проекта «Столярка»',
  project_consulting: 'Чат проекта «ПО/Консалтинг»',
};

/** Какой бот отправляет. Токены разные, перепутать нельзя. */
export type NotifyBot = 'payments' | 'igor' | 'salary';

export const BOT_NAMES: Record<NotifyBot, string> = {
  payments: 'Бот уведомлений (оплаты, продажи)',
  igor: 'Игорь (системные алерты)',
  salary: 'Бот зарплаты',
};

/** Раздел — только для группировки в интерфейсе. */
export type NotifyGroup = 'payments' | 'sales' | 'quality' | 'system' | 'salary';

export const GROUP_NAMES: Record<NotifyGroup, string> = {
  payments: 'Оплаты',
  sales: 'Продажи',
  quality: 'Качество и регламенты',
  system: 'Система',
  salary: 'Зарплата',
};

export interface NotifyTypeDef {
  /** Технический код — ключ в notification_routes, в интерфейсе не показываем. */
  code: string;
  /** Человеческое название — то, что видит человек в настройках. */
  name: string;
  /** Что это за сообщение и когда приходит. */
  description: string;
  group: NotifyGroup;
  bot: NotifyBot;
  /** Адресат по умолчанию — пока человек не переопределил в интерфейсе. */
  target: NotifyTarget;
  /** Адресат жёстко задан природой сообщения (личный план — только этому менеджеру). */
  targetFixed?: boolean;
}

export const NOTIFY_TYPES: NotifyTypeDef[] = [
  // ─── Оплаты ───────────────────────────────────────────────────────────────
  {
    code: 'payment.received',
    name: 'Оплата поступила и разнесена',
    description: 'Деньги пришли и привязаны к заказу ЗМКТЛ: сумма, плательщик, заказ, перевод в производство.',
    group: 'payments',
    bot: 'payments',
    target: 'group_sales',
  },
  {
    code: 'payment.pending_digest',
    name: 'Поступления требуют разбора',
    description: 'Дайджест денег, которые пришли, но не привязаны к заказу — заказ не едет в производство.',
    group: 'payments',
    bot: 'payments',
    target: 'group_sales',
  },
  {
    code: 'tseh.order_accepted',
    name: 'Заказ заведён в ЦехУспехе',
    description:
      'Заказ, переданный в производство, появился в ЦехУспехе: номер там, заказчик и сумма. '
      + 'Повод проверить оформление — состав, сроки, реквизиты заказчика.',
    group: 'quality',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'tseh.order_rejected',
    name: 'Заказ не принят производством',
    description:
      'ЦехУспех отказался заводить заказ и назвал причину — например, у заказчика нет ИНН. '
      + 'Заказ в производство не уехал, нужно поправить и передать заново.',
    group: 'quality',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.crm_site_missing',
    name: 'Магазин заявок пропал в RetailCRM',
    description: 'RetailCRM перестала принимать настроенный магазин — заявки с почты заводятся в запасном. Нужно проверить магазин в CRM.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'payment.push_error',
    name: 'Оплата не проведена в CRM',
    description: 'Платёж привязан к заказу, но RetailCRM его не принял — сбой, чинится руками.',
    group: 'payments',
    bot: 'payments',
    target: 'owner_dm',
  },
  {
    code: 'payment.project_stolyarka',
    name: 'Оплата проекта «Столярка»',
    description: 'Поступление опознано как выручка столярки — уходит в чат этого проекта.',
    group: 'payments',
    bot: 'payments',
    target: 'project_stolyarka',
    targetFixed: true,
  },
  {
    code: 'payment.project_consulting',
    name: 'Оплата проекта «ПО/Консалтинг»',
    description: 'Поступление за ПО или консалтинг — уходит в чат этого проекта.',
    group: 'payments',
    bot: 'payments',
    target: 'project_consulting',
    targetFixed: true,
  },

  // ─── Продажи ──────────────────────────────────────────────────────────────
  {
    code: 'sales.plan_daily_group',
    name: 'План дня — сводка по отделу',
    description: 'Утренняя сводка: сколько задач у каждого менеджера, нагрузка отдела.',
    group: 'sales',
    bot: 'payments',
    target: 'group_sales',
  },
  {
    code: 'sales.plan_daily_dm',
    name: 'План дня — подробный, менеджеру',
    description: 'Персональный список задач на день: заказы, звонки, что спросить.',
    group: 'sales',
    bot: 'payments',
    target: 'manager_dm',
    targetFixed: true,
  },
  {
    code: 'sales.evening_review_group',
    name: 'Разбор дня — сводка по отделу',
    description: 'Вечером: что сделано отделом, разговоры, выполнение плана.',
    group: 'sales',
    bot: 'payments',
    target: 'group_sales',
  },
  {
    code: 'sales.evening_review_dm',
    name: 'Разбор дня — менеджеру',
    description: 'Персональный разбор звонков менеджера по расшифровкам.',
    group: 'sales',
    bot: 'payments',
    target: 'manager_dm',
    targetFixed: true,
  },
  {
    code: 'sales.plan_copy_owner',
    name: 'Копия планов дня владельцу',
    description: 'Те же планы менеджеров слово в слово — владельцу, чтобы видеть, что раздали.',
    group: 'sales',
    bot: 'payments',
    target: 'owner_dm',
  },
  {
    code: 'sales.bot_failure',
    name: 'Бот-РОП не отработал',
    description: 'Утренний или вечерний прогон упал — планы и отчёты не ушли.',
    group: 'system',
    bot: 'payments',
    target: 'owner_dm',
  },
  {
    code: 'sales.owner_report',
    name: 'Отчёт владельцу',
    description: 'Сводка по отделу за день для владельца — с цифрами по каждому.',
    group: 'sales',
    bot: 'payments',
    target: 'owner_dm',
  },
  {
    code: 'sales.orphan_orders',
    name: 'Заказы без менеджера',
    description: 'Заказы, у которых не определён ответственный — их никто не ведёт.',
    group: 'sales',
    bot: 'payments',
    target: 'group_sales',
  },

  // ─── Качество и регламенты ────────────────────────────────────────────────
  {
    code: 'quality.rule_violation',
    name: 'Нарушение регламента продаж',
    description: 'Правило ОКК сработало на заказе или звонке — нарушение регламента.',
    group: 'quality',
    bot: 'igor',
    target: 'group_sales',
  },
  {
    code: 'quality.sla_breach',
    name: 'Просрочка SLA по заказу',
    description: 'Заказ висит дольше нормы — реакция отдела просрочена.',
    group: 'quality',
    bot: 'igor',
    target: 'group_sales',
  },
  {
    code: 'calls.missed_incoming',
    name: 'Пропущенный входящий звонок',
    description: 'Клиент позвонил и не дозвонился — надо перезвонить.',
    group: 'quality',
    bot: 'igor',
    target: 'group_sales',
  },

  // ─── Система ──────────────────────────────────────────────────────────────
  {
    code: 'system.audit_alert',
    name: 'Сбой конвейера данных',
    description: 'Аудит нашёл отставание синхронизации или очередь, которая встала.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.stt_watchdog',
    name: 'Сторож транскрибации',
    description: 'Очередь расшифровки звонков встала или снова поехала.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.ai_balance',
    name: 'Баланс платных сервисов ИИ',
    description: 'Деньги на OpenAI и прочих сервисах заканчиваются.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.ai_health',
    name: 'Здоровье ИИ-сервисов',
    description: 'Проверка доступности моделей и ключей: что-то отвечает ошибкой или не отвечает.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.errors_digest',
    name: 'Ошибки в системе',
    description: 'Сводка сбоев за последний час: заявки, оплаты, план работ, задачи конвейера. Про каждую ошибку сообщаем один раз.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },
  {
    code: 'system.crash',
    name: 'Авария системы',
    description: 'Упал крон или воркер — сообщение с текстом ошибки.',
    group: 'system',
    bot: 'igor',
    target: 'owner_dm',
  },

  // ─── Зарплата ─────────────────────────────────────────────────────────────
  {
    code: 'salary.payroll_to_accounting',
    name: 'Ведомость зарплаты в бухгалтерию',
    description: 'Файл ведомости при закрытии периода — уходит получателям из настроек бухгалтерии.',
    group: 'salary',
    bot: 'salary',
    target: 'accounting',
    targetFixed: true,
  },
];

export const NOTIFY_TYPE_BY_CODE = new Map(NOTIFY_TYPES.map((t) => [t.code, t]));

export function notifyType(code: string): NotifyTypeDef {
  const def = NOTIFY_TYPE_BY_CODE.get(code);
  if (!def) throw new Error(`Неизвестный тип уведомления: ${code}`);
  return def;
}
