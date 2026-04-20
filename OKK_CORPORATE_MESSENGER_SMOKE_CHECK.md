# Корпоративный мессенджер: smoke-check для GitHub + Vercel + Supabase

Статус: production-oriented чеклист для проверки после деплоя через GitHub -> Vercel с рабочим Supabase-проектом.

## 1. Предусловия

- [ ] Актуальная ветка с messenger-изменениями запушена в GitHub.
- [ ] В Vercel задеплоен commit, содержащий последние миграции messenger.
- [ ] Миграции Supabase применены к production-проекту.
- [ ] В Vercel заданы и валидны переменные окружения:
  - [ ] NEXT_PUBLIC_SUPABASE_URL
  - [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
  - [ ] SUPABASE_SERVICE_ROLE_KEY
  - [ ] RETAILCRM_URL или RETAILCRM_BASE_URL или NEXT_PUBLIC_RETAILCRM_URL
  - [ ] NEXT_PUBLIC_VAPID_PUBLIC_KEY
  - [ ] VAPID_PRIVATE_KEY
  - [ ] VAPID_SUBJECT
- [ ] В Supabase существуют и доступны таблицы messenger-контура:
  - [ ] chats
  - [ ] chat_participants
  - [ ] messages
- [ ] В Supabase существует bucket chat-attachments и применены storage policies.
- [ ] В Supabase Realtime publication включает chats и messages.
- [ ] В Supabase применена миграция для messenger_push_subscriptions.
- [ ] В Supabase применены runtime-миграции для messenger_push_presence и messenger_push_delivery_logs.
- [ ] При необходимости для быстрой API-проверки подготовлены env для скрипта `npm run messenger:api-smoke`:
  - [ ] MESSENGER_BASE_URL
  - [ ] MESSENGER_BEARER_TOKEN или MESSENGER_LOGIN + MESSENGER_PASSWORD
  - [ ] MESSENGER_CHAT_ID
  - [ ] MESSENGER_FORBIDDEN_CHAT_ID
  - [ ] MESSENGER_ENABLE_MUTATION_CHECKS (optional, по умолчанию true)
  - [ ] MESSENGER_TEST_MESSAGE_PREFIX (optional)
  - [ ] MESSENGER_SECOND_BEARER_TOKEN или MESSENGER_SECOND_LOGIN + MESSENGER_SECOND_PASSWORD (optional, для двухпользовательских direct/group smoke-path)
  - [ ] MESSENGER_DIRECT_PARTICIPANT_ID (optional, должен соответствовать second user)
  - [ ] MESSENGER_GROUP_PARTICIPANT_IDS (optional, comma-separated manager ids для временного group-chat smoke)
  - [ ] MESSENGER_GROUP_EXTRA_PARTICIPANT_ID (optional, для add/remove member path)

## 2. Деплой и базовая доступность

- [ ] Открыть production URL на Vercel.
- [ ] Убедиться, что страница [app/messenger/page.tsx](/Users/andreiterenkov/OKKRiteilCRM-actual/app/messenger/page.tsx) доступна из штатной навигации.
- [ ] Убедиться, что раздел открывается без 500/401 для авторизованного пользователя.
- [ ] Убедиться, что список чатов загружается без ошибок.
- [ ] Убедиться, что пустое состояние раздела и состояние выбранного чата визуально выглядят консистентно с остальным приложением.

## 3. Direct-chat сценарий

- [ ] Пользователь A открывает раздел мессенджера.
- [ ] Пользователь A создаёт direct-chat с пользователем B.
- [ ] Проверить, что direct-chat не дублируется при повторной попытке создания с тем же пользователем.
- [ ] Пользователь A отправляет текстовое сообщение.
- [ ] Пользователь B видит чат в списке и получает unread badge.
- [ ] Пользователь B открывает чат.
- [ ] Проверить, что unread badge у пользователя B исчезает после открытия.
- [ ] Проверить, что имя direct-chat отображается как имя второго участника, а не текущего пользователя.
- [ ] Проверить, что собственные сообщения пользователя не попадают в unread_count.

## 4. Group-chat сценарий

- [ ] Пользователь A создаёт group-chat минимум с двумя участниками.
- [ ] Проверить, что в истории появляется system message о создании группы.
- [ ] Администратор группы переименовывает чат.
- [ ] Проверить, что новое имя отражается в header и в sidebar.
- [ ] Проверить, что в истории появляется system message о переименовании.
- [ ] Администратор добавляет нового участника.
- [ ] Проверить, что участник появляется в модальном окне участников.
- [ ] Проверить, что в истории появляется system message о добавлении участника.
- [ ] Администратор удаляет участника.
- [ ] Проверить, что участник исчезает из списка и что появляется system message об удалении.
- [ ] Администратор выходит из группового чата.
- [ ] Проверить, что при необходимости автоматически назначается новый admin.
- [ ] Последний участник выходит из группового чата.
- [ ] Проверить, что чат удаляется целиком вместе с cleanup вложений.

## 5. Сообщения, вложения и безопасность доступа

Модель доступа описана отдельно в [OKK_CORPORATE_MESSENGER_ACCESS_MODEL.md](OKK_CORPORATE_MESSENGER_ACCESS_MODEL.md).

- [ ] Пользователь A отправляет обычное текстовое сообщение.
- [ ] Пользователь A отправляет сообщение с изображением.
- [ ] Пользователь A отправляет сообщение с не-image вложением.
- [ ] Проверить, что изображение показывается с preview.
- [ ] Проверить, что файл скачивается через защищённый endpoint, а не через публичный storage URL.
- [ ] Пользователь B, состоящий в чате, может скачать вложение.
- [ ] Пользователь C, не состоящий в чате, не может прочитать сообщения этого чата через API.
- [ ] Пользователь C, не состоящий в чате, не может скачать attachment этого чата через API.
- [ ] Удалённый из группового чата участник теряет доступ к новым сообщениям и вложениям.
- [ ] Проверить отказ на неподдерживаемый тип файла.
- [ ] Проверить отказ на превышение лимита размера файла.

## 6. Realtime и деградация

- [ ] Открыть один и тот же чат у двух пользователей одновременно.
- [ ] Отправить сообщение от пользователя A и проверить near-real-time появление у пользователя B без ручного refresh.
- [ ] Проверить, что sidebar обновляет last message и unread badge после нового сообщения.
- [ ] Проверить, что пагинация старых сообщений работает без дублей и пропусков.
- [ ] Смоделировать отсутствие Realtime subscription или временный сбой канала.
- [ ] Проверить, что ручной reload чата восстанавливает корректное состояние сообщений.
- [ ] Проверить, что UI показывает error/retry вместо silent failure.

## 7. UX и пользовательские статусы

- [ ] Проверить локальный pending status во время отправки сообщения.
- [ ] Проверить failed status при искусственно сорванной отправке.
- [ ] Проверить retry-path пользователя через повторную отправку.
- [ ] Проверить поиск по чатам в sidebar.
- [ ] Проверить, что order context в header открывает корректный RetailCRM deep link.
- [ ] Проверить мобильную ширину экрана и desktop layout без визуальных артефактов.

## 8. Удаление и консистентность данных

- [ ] Пользователь удаляет своё сообщение.
- [ ] Проверить, что сообщение исчезает из UI и из API-выдачи.
- [ ] Проверить, что вложения удалённого сообщения чистятся из storage.
- [ ] Администратор удаляет group-chat.
- [ ] Проверить, что чат исчезает из sidebar у участников.
- [ ] Проверить, что вложения удалённого чата удаляются из bucket.

## 9. Наблюдаемость

- [ ] Проверить Vercel logs для messenger API routes после базового smoke-прохода.
- [ ] Убедиться, что ошибки логируются через единый messenger logger, а не разрозненные console.error в route handlers.
- [ ] Убедиться, что в логах есть единый scope для messenger error events.

## 10. Push-блок

Push-уведомления уже реализованы в коде, поэтому этот раздел обязателен для production-проверки после деплоя.

- [ ] Проверить desktop push: разрешение, получение уведомления в фоне, переход по клику в нужный чат.
- [ ] Проверить mobile push: получение уведомления на Android и iPhone, открытие нужного чата, корректную работу после reinstall/relogin.
- [ ] Проверить отсутствие push на собственные сообщения.
- [ ] Проверить отсутствие дублей на нескольких вкладках и устройствах.
- [ ] Проверить suppression: если чат уже открыт в активной вкладке, push не приходит.
- [ ] Проверить delivery audit в messenger_push_delivery_logs: sent, skipped_active_chat, skipped_muted, failed, revoked token path.
- [ ] Проверить self-heal после logout/login: после повторного входа текущий браузер автоматически регистрирует endpoint заново без ручной очистки БД.
- [ ] Проверить self-heal после очистки локальной browser subscription/site data: при сохранённом permission клиент восстанавливает subscription и повторно делает upsert на сервер.
- [ ] Проверить смену браузера или устройства: новый endpoint регистрируется отдельно, а сервер выбирает один primary endpoint на пользователя для доставки.

## 11. Итог выпуска

- [ ] Все критичные сценарии из разделов 2-9 пройдены в production-среде.
- [ ] Скрипт `npm run messenger:api-smoke` отрабатывает без ошибок на deployed environment.
- [ ] Скрипт `npm run messenger:api-smoke` проверяет не только read-path, но и create/delete probe message, 400/403 negative paths, а при наличии optional env ещё direct unread flow, attachment upload/download и group lifecycle.
- [ ] Найденные проблемы либо исправлены, либо явно зафиксированы как release blocker / accepted risk.
- [ ] После smoke-check обновлён [OKK_CORPORATE_MESSENGER_READINESS_PLAN.md](/Users/andreiterenkov/OKKRiteilCRM-actual/OKK_CORPORATE_MESSENGER_READINESS_PLAN.md).
