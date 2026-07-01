# Катерина — секретарь приёма почты (email-секретарь)

> **Канонический as-built обзор. Будущие чаты по Катерине начинают ОТСЮДА** (прочитать до погружения в код).
> Если код разошёлся с документом — обнови документ. Обновлён: 01.07.2026.

Катерина — ИИ-агент, который разбирает входящую электронную почту компании. Новые заявки она
заводит в RetailCRM заказом (с вложениями) и назначает менеджера, письма для смежных отделов
(бухгалтерия / логистика / юрист / снабжение) пересылает на их адреса по содержанию, переписку по
заказам и спам — размечает и пропускает. Работает автоматически. Экран — `/agents/katerina`, домен
«Секретариат». Не путать с голосовым секретарём Телфина (звонки) — Катерина только про почту.

## Цикл (крон `/api/cron/email-poll`, раз в 5 минут)

1. Читает ящик `rop@zmktlt.ru` по IMAP только-чтение (флаги `\Seen` не трогает; RetailCRM читает тот
   же ящик независимо). Инкремент по IMAP UID (`email_ingest_state`), старый архив не разбирает.
2. Складывает новые письма в `incoming_emails` (дедуп по `message_id`/uid).
3. По каждому письму со `status='new'` выбирает **один маршрут** и выполняет действие.

## Маршруты (типы `email_type`)

ИИ-модель возвращает один из 6 кодов; ещё 3 типа — производные (ставит воркер):

| Тип | Кто ставит | Действие |
|---|---|---|
| `new_request` | ИИ | Создаёт заказ + назначает менеджера + прикрепляет вложения |
| `accounting` / `logistics` / `legal` / `procurement` | ИИ | Пересылает оригинал письма на адрес отдела |
| `not_request` | ИИ | Пропуск (спам/рассылки/отказы) |
| `reply_thread` | воркер (производный) | Переписка по существующему заказу — заказ не плодим |
| `blocked` | воркер (производный) | Контрагент в списке исключений — заказ не создаём |
| `noreply` | воркер (пре-фильтр) | Робот-отправитель (`noreply`/`no-reply`) — ИИ не вызываем |

### Правила поверх ИИ-ответа (в воркере, детерминированные)

- **Пре-фильтр noreply** (`isNoReplySender`) → `noreply`, ИИ не вызываем.
- **Переписка по заказу** (`isReplyThread`: латинский `Re:`/`RE[2]:` ИЛИ тег `[#N/NNNNN]`):
  - ИИ сказал `new_request` → **`reply_thread`** (не плодим дубль заказа).
  - ИИ сказал `procurement` → **`reply_thread`** (снабжение = НОВОЕ предложение поставщика; «Re:» на наш
    заказ туда не шлём).
  - ИИ сказал `not_request`, но есть **тег `[#N/N]`** (`hasCrmOrderTag`) → **`reply_thread`** (отказы
    «не актуально»/«нет финансирования» по заказу — это переписка, а не «не заявка»).
  - `accounting`/`logistics`/`legal` по переписке по заказу — **пересылаем как обычно** (вопрос по
    счёту/доставке/договору реально нужен отделу).
- **Блок-лист** (`isSenderBlocked`): если отправитель в `email_intake_config.order_blocklist` и маршрут
  `new_request` → тип становится **`blocked`**, заказ не создаём, менеджера не назначаем.
- **Направление сделки важнее должности отправителя** (в промпте): снабженец компании-КЛИЕНТА, который
  просит поставить ему наш товар («необходимо к закупу… есть возможность поставки?», карточка
  предприятия) — это `new_request`, а НЕ `procurement`. `procurement` — только когда отправитель сам
  предлагает продать НАМ.

Промпт живёт в БД (`ai_prompts`, key `email_secretary_classifier`), фолбэк-дефолт — в
`lib/email/classify.ts` (`DEFAULT_SYSTEM_PROMPT`). Правится без кода, НО менять его надо вместе с
деплоем кода (см. подводные камни).

## Пересылка в отдел

Адреса отделов — в `email_intake_routes` (без хардкода, правятся на экране Катерины). Пока адрес пуст —
`needs_review`, письмо не теряется. Пересылается оригинал с **вложениями** (докачиваются по IMAP UID,
в БД не храним). `Reply-To` = клиент. Хелпер `forwardToDepartment` в крон-роуте, отправка —
`sendAppEmail` (`lib/email.ts`). Гейт — `email_intake_config.forward_enabled`.

## Создание заказа + вложения

- `createEmailLead` (`lib/retailcrm/leads.ts`): клиент по email → заказ статус `novyi-1` → менеджер.
- **Комментарий заказа**: текст письма; если plain-текста нет (HTML-only) — вытаскиваем из HTML
  (`stripHtml`); если тело пустое, а есть вложения — пишем «суть во вложении» + список файлов.
- **Вложения в заказ** (`lib/retailcrm/files.ts`, `attachEmailFilesToOrder`): все вложения письма
  грузятся в заказ через RetailCRM API v5 `files/upload` (сырой бинарь) + `files/{id}/edit`
  (`attachment:[{order:{id}}]`). Лимит 20 МБ/файл, best-effort (ошибка не отменяет заказ, пишется в
  reasoning). ТЗ обычно во вложении — поэтому это важно.
- Гейт — `email_intake_config.create_orders`.

## Распределение менеджеров (`lib/email/assign.ts`)

1. **По истории клиента** (`findOwnerByEmail`): менеджер последнего заказа этого email, если он в пуле.
   Постоянный клиент → к своему менеджеру. Работает **даже если менеджер в отпуске** (полный пул).
2. **Поровну за период** среди ДОСТУПНЫХ (`balancePool` = пул минус отпускники): наименее загруженному
   за окно `balance_window_days` (по умолч. 7). Балансируется поток заявок секретаря, не остатки заказов.

- **Пул** — `email_intake_pool` (сейчас: Матвеева 98, Парфёнова 10, Гордеева 249). В коде не хардкод.
- **Отпуска** — `email_intake_absences` (manager_id, start_date, end_date). В период отсутствия менеджер
  выпадает из слоя 2 (новых не даём), слой 1 (свои клиенты) сохраняется. Правится в блоке «Отпуска» на
  экране Катерины (`/api/agents/katerina/absences`).

## Устойчивость (важно!)

- **Сбой анализа не теряет заявку.** `classifyRoute` при ошибке (напр. OpenAI недоступен) отдаёт
  `failed=true` → воркер НЕ финализирует письмо (`continue`, оставляет `status='new'`) → следующий крон
  повторит. Раньше транзиентная ошибка навсегда метила письмо `not_request`.
- **HTML-only письма** больше не «слепые»: `stripHtml(body_html)` как фолбэк для классификации и для
  комментария заказа.
- **Плашка «Исчерпан баланс OpenAI».** При 429 `insufficient_quota` поднимается алерт (`system_alerts`,
  key `openai_quota`, пишется из `lib/openai-health.ts`), общий `app/layout.tsx` показывает красную
  полосу через `SystemAlertsBanner`. Снимается автоматически при первом успешном вызове. Причина: инцидент
  01.07 — баланс кончился на ~2 часа, поток молча ушёл в `not_request`, потеряно 5 заявок.

## Тумблеры/настройки (`email_intake_config`, singleton)

`create_orders` (заказы), `forward_enabled` (пересылка), `balance_window_days` (7), `order_blocklist`
(text[] адресов/доменов), `load_exclude_status_codes`. Всё правится в UI, не в коде.

---

# Технический справочник (для будущих чатов)

## Карта файлов
- `app/api/cron/email-poll/route.ts` — воркер (ingest + классификация + маршрутизация + заказ/пересылка). `@ts-nocheck`.
- `lib/email/classify.ts` — `classifyRoute`, `isReplyThread`, `hasCrmOrderTag`, `isNoReplySender`, `stripHtml`, `documentAttachmentNames`, `DEFAULT_SYSTEM_PROMPT`, `loadSecretaryPrompt`.
- `lib/email/routes.ts` — адреса отделов, `getOrderBlocklist`, `isSenderBlocked`, `isForwardEnabled`.
- `lib/email/assign.ts` — пул, баланс, история, `getManagersOnLeave`, `getAbsences`, `resolveAssignment`.
- `lib/email/imap.ts` — `fetchNewEmails` (read-only), `fetchEmailContentByUid` (докачка вложений).
- `lib/retailcrm/leads.ts` — `createEmailLead`, `getCrmConfig` (exported). `lib/retailcrm/files.ts` — `attachEmailFilesToOrder`.
- `lib/openai-health.ts` — алерт квоты OpenAI. `app/components/SystemAlertsBanner.tsx` — плашка в layout.
- `app/agents/katerina/page.tsx` + `RoutesSettings.tsx` + `AbsencesSettings.tsx` — экран/настройки.
- API: `app/api/agents/katerina/routes/route.ts` (маршруты, блок-лист, тумблеры), `.../absences/route.ts` (отпуска). RBAC-префикс `/api/agents/katerina` = admin/rop.

## Таблицы БД
`incoming_emails` (журнал+вердикт: email_type, confidence, reasoning, assigned_manager_id,
created_crm_order_number, forwarded_*, status), `email_ingest_state` (указатель UID),
`email_intake_config` (singleton-настройки), `email_intake_routes` (отделы), `email_intake_pool` (пул),
`email_intake_absences` (отпуска), `system_alerts` (плашки), `ai_prompts` (промпт `email_secretary_classifier`).

## Подводные камни / инварианты
- **Локально НЕТ RetailCRM-кредов** → `createEmailLead`/файлы работают только из прода. Завести заказ по
  письму = деплой + переочередь (ниже) ИЛИ вручную в RetailCRM.
- **Локально НЕТ service-role** (только ANON) → работать с БД прямым `pg` по `DATABASE_URL`, не supabase-клиентом.
- **IMAP локально НЕ работает** (DPI РФ) → живой ящик читает только прод-крон; локально брать письма из `incoming_emails`.
- **Локальный ключ OpenAI мог исчерпаться** (был инцидент 01.07) — тесты классификатора локально могут падать 429.
- **Промпт в БД менять ТОЛЬКО вместе с деплоем кода** (иначе окно рассинхрона роняет поток в `not_request`).
  Правки контракта маршрутов — через миграцию, применяемую при деплое.
- **Деплой:** прод = `main`; фичи коммитятся на feat и переносятся в main через `cherry-pick` (не merge feat целиком —
  там есть sales-bot, который в main не пускаем). Миграции — аддитивный сырой SQL в `migrations/`.

## Восстановление потерянных писем (переочередь)
```sql
UPDATE incoming_emails SET status='new', email_type=NULL, forwarded_to=NULL,
       forwarded_department=NULL, forwarded_at=NULL
WHERE created_crm_order_number IS NULL AND <условие>;
```
Прод-крон переразберёт рабочим AI. Примеры скриптов — `scratch/recover_batch.mjs`, `scratch/requeue_*.mjs`.
Переразметка без ИИ (детерминированно) — прямой UPDATE `email_type` (напр. тег `[#N/N]` + not_request → reply_thread).

## Как проверить
- Разбор ленты: `SELECT ... FROM incoming_emails WHERE received_at >= now()-interval 'N days'`.
- Классификатор вживую (когда квота OpenAI жива): загрузить прод-промпт из `ai_prompts`, собрать userContent
  (subject + вложения + body/stripHtml(html)), вызвать gpt-4o-mini temperature 0 — см. `scratch/*classify*.mjs`.
