# План развития Консультанта ОКК (Семён)

Статус: актуализированный gap-driven план после сверки с текущим кодом.

Основания для плана:
- Текущая доменная модель и section catalog: [lib/okk-consultant.ts](lib/okk-consultant.ts#L158)
- Prompt и knowledge layer: [lib/okk-consultant-ai.ts](lib/okk-consultant-ai.ts#L1)
- API-оркестрация консультанта: [app/api/okk/consultant/route.ts](app/api/okk/consultant/route.ts#L1)
- Сидинг базы знаний и prompt-конфигов: [scripts/seed_okk_consultant_kb.ts](scripts/seed_okk_consultant_kb.ts#L1)
- План обучения по всей ОКК: [SEMYON_OKK_TRAINING_PLAN.md](SEMYON_OKK_TRAINING_PLAN.md#L1)
- План UX-упрощения панели: [OKK_CHAT_UX_SIMPLIFICATION_PLAN.md](OKK_CHAT_UX_SIMPLIFICATION_PLAN.md#L1)

## 1. Цель

- Довести Семёна до уровня стабильного методолога-консультанта по всей ОКК, а не справочного чат-слоя.
- Сделать ответы предсказуемыми по качеству через единый контур: structured catalog -> prompt/knowledge -> regression.
- Закрыть реальные gaps в routing, структуре экранных объяснений, tests/privacy и legacy cleanup без повторной реализации уже готовых частей.

## 2. Что уже подтверждено в коде

Ниже перечислено то, что не нужно повторно планировать как новую разработку.

- [x] В проекте уже есть section catalog с overview и topic-ответами по нескольким разделам, включая efficiency, ai-tools и audit.
- [x] В проекте уже есть intent routing для section questions, formula, glossary, criterion, score, proof, fix и fallback.
- [x] В проекте уже есть evidence-first схема для вопросов по конкретному заказу.
- [x] В проекте уже есть role-based sanitization для order/evidence на API boundary до генерации ответа.
- [x] В проекте уже есть DB-backed prompt layer и семантический knowledge search для fallback-ответов.
- [x] Во frontend-панели больше не отправляется responseMode как обязательный параметр.
- [x] Backend уже трактует отсутствие responseMode как full по умолчанию.
- [x] В проекте уже есть аудит trace/thread/fallback и отдельный экран аудита.

## 3. Главные реальные проблемы

### 3.1 Устаревание самого плана

- Предыдущая версия документа смешивала уже реализованные задачи и реальные пробелы.
- Из-за этого план был плохим backlog-документом: по нему нельзя было понять, что ещё действительно нужно делать, а что уже сделано.

### 3.2 Размытый source of truth

- Сейчас знания консультанта живут минимум в двух слоях: в статическом catalog внутри кода и в seeded knowledge/prompt layer для fallback.
- Без явного правила, какой слой является master-source для экранных объяснений, легко получить рассинхрон между жёсткими ответами, fallback-ответами и содержимым базы знаний.

### 3.3 Слабая модель экранных объяснений

- Для section-ответов уже есть overviewAnswer и topics, но этой модели не хватает для системного объяснения экрана по блокам.
- Простое добавление ещё двух больших string-полей не решает проблему, а размножает prose и усложняет поддержку.

### 3.4 Слишком грубая section routing логика

- Текущий genericPrompt остаётся широким и покрывает слишком много разных классов вопросов.
- Идея искать entity-ответы внутри свободного текста вида keyElementsAnswer архитектурно слабая: routing не должен зависеть от редакторского prose.

### 3.5 Нет обязательного барьера качества

- Для консультанта нельзя оставлять формулировку "регрессионные тесты, если они есть".
- После крупных правок по routing, prompt или catalog должны быть обязательные regression checks, в том числе privacy- и anti-slop-проверки.

### 3.6 Legacy-хвосты вокруг responseMode

- UI уже живёт в режиме full-by-default.
- Но в API и metadata до сих пор существует legacy-ветка short/full.
- Это уже не продуктовая задача UX, а технический cleanup и решение по обратной совместимости.

## 4. Архитектурные инварианты

Эти правила обязательны для всех дальнейших изменений.

### 4.1 Security boundary

- Любые role-based ограничения должны применяться до попадания данных в builder-функции, prompt-контекст и fallback-LLM.
- Запрещено делать privacy защиту только на уровне отдельных formatter/helper-функций.
- Инвариант: сырые чувствительные данные не должны попадать в текстогенерацию для ролей без соответствующего доступа.

### 4.2 Единый источник контента

- Для каждого класса знаний должен быть определён master-source.
- Если source of truth остаётся в code catalog, seeded knowledge layer должна собираться только из него.
- Если часть контента управляется через БД, должно быть явно указано, какие ответы читаются из кода, а какие из DB-managed layer.

### 4.3 Routing по структуре, а не по prose

- Routing должен опираться на структурированные alias/entity/mode definitions.
- Запрещено строить логику распознавания сущностей по случайным вхождениям в длинные редакторские тексты.

### 4.4 Full-by-default

- Полный рабочий ответ является единственным стандартным режимом ответа по умолчанию.
- Сжатый ответ допускается только как осознанный follow-up от пользователя или как отдельная внутренняя стратегия форматирования, а не как UI-переключатель.

### 4.5 Regression first

- Любая правка section catalog, prompt layer, routing или sanitization должна сопровождаться регрессией.
- Для privacy и factual grounding нужны отдельные проверки, а не только smoke-check вручную.

## 5. Целевое состояние модели контента

Для screen-level ответов нужен не набор новых произвольных string-полей, а структурная модель объяснения.

Минимальная целевая структура section content:

- purpose: зачем нужен раздел;
- workflow: как пользователь с ним работает по шагам;
- keyEntities: список ключевых сущностей/виджетов/колонок с aliases и объяснениями;
- outcomes: что пользователь получает на выходе;
- modes: какие режимы или сценарии различаются;
- pitfalls: типовые ошибки интерпретации.

Требования к keyEntities:

- каждая сущность должна иметь stable key;
- каждая сущность должна иметь aliases для routing;
- каждая сущность должна иметь самостоятельное explanation, а не ссылку на общий prose-блок;
- сущности должны быть пригодны и для section answer, и для knowledge seeding, и для regression cases.

## 6. Реальные workstreams

### P0. Нормализация и защита текущей архитектуры

- [ ] Переписать плановые документы так, чтобы они больше не дублировали уже реализованные задачи.
- [x] Явно зафиксировать source-of-truth policy для catalog, seeded KB и DB prompts.
- [x] Формализовать security boundary как обязательный инвариант на API layer.
- [x] Добавить regression suite для routing, privacy masking и factual screen answers.
- [x] Принять решение по legacy responseMode: активная runtime-ветка short/full удалена, в metadata оставлен только full для совместимости чтения.

### P1. Перестройка модели section explanations

- [x] Заменить идею "добавить ещё два длинных string-поля" на структурную section model.
- [x] Уточнить section answer pipeline: overview-question, topic-question, entity-question, mode-question, empty-state-question.
- [x] Убрать зависимость entity routing от свободного prose.
- [x] Привести screen-level ответы к единому формату: purpose -> workflow -> key entities -> outcome -> limits.

### P1. Наполнение пробелов по домену

- [x] Проверить, каких section configs реально не хватает по карте ОКК.
- [x] Добить недостающий контент по rules и другим ещё не закрытым разделам.
- [x] Привести criterion/formula/glossary ответы к более human-friendly формату и закрепить это benchmark-кейсами.
- [x] Добить keyEntities и mode explanations для разделов, где сейчас есть только общий overview.

### P1. Регрессия по качеству ответов

- [x] Собрать обязательный benchmark по screen questions, entity questions, formula questions, glossary questions и order-specific questions.
- [x] Добавить запрещённые паттерны ответа: summary вместо объяснения, перечисление терминов без смысла, выдумывание отсутствующих данных.
- [x] Отдельно добавить privacy regression cases для manager/other non-admin roles.
- [x] Отдельно добавить routing regression cases на близкие формулировки одного и того же вопроса.
- [x] Добавить regression coverage для human-friendly criterion guidance в whyFail/howToFix слое.

### P2. Cleanup и наблюдаемость

- [x] Почистить legacy-код responseMode, если он больше не нужен продукту.
- [x] В audit layer добавить более явные признаки того, какой именно branch routing сработал для screen/entity/mode questions.
- [x] При необходимости расширить admin-аудит, чтобы легче ловить regressions по стилю ответа и утечкам private data.

## 7. Ожидаемые изменения по файлам

Это не исчерпывающий список, а основной контур реализации.

- [x] [lib/okk-consultant.ts](lib/okk-consultant.ts): новая структурная модель section content, доработка routing, нормализация aliases/entities/modes, formula/glossary builders.
- [x] [lib/okk-consultant-kb.ts](lib/okk-consultant-kb.ts): единый pure builder для consultant KB rows без drift между runtime catalog и seeding.
- [x] [app/api/okk/consultant/route.ts](app/api/okk/consultant/route.ts): формализация boundary-инвариантов, cleanup legacy responseMode, дополнительные audit markers.
- [x] [components/OKKConsultantAudit.tsx](components/OKKConsultantAudit.tsx): fallback-отображение legacy trace metadata без потери reply/routing смысла.
- [x] [lib/okk-consultant-ai.ts](lib/okk-consultant-ai.ts): синхронизация prompt-правил с новой section model и regression expectations.
- [x] [scripts/seed_okk_consultant_kb.ts](scripts/seed_okk_consultant_kb.ts): синхронный seeding из нового structured catalog без ручного дублирования prose.
- [x] [scripts/okk_consultant_regression.ts](scripts/okk_consultant_regression.ts): обязательный benchmark для screen/entity/privacy/routing cases.
- [x] [scripts/okk_consultant_real_cases.fixture.json](scripts/okk_consultant_real_cases.fixture.json): живой anonymized golden dataset для regression barrier по реальным кейсам.

## 8. Критерии приёмки

### 8.1 Контент и routing

- [x] Вопросы вида "что это за раздел" стабильно дают ответ в структуре purpose -> workflow -> key entities -> outcome.
- [x] Вопросы вида "что значит эта колонка/поле/виджет" обрабатываются через entity routing, а не через случайное совпадение во free-text prose.
- [x] Вопросы по формулам, критериям и glossary не деградируют после перестройки section model.

### 8.2 Безопасность

- [x] Для ролей без admin/okk доступа чувствительные данные не попадают ни в structured builders, ни в fallback prompt context, ни в итоговый ответ; это подтверждено sanitization-path и privacy regression для manager-facing output.
- [x] Для manager regression cases отсутствуют полные телефоны, email, сырые customer comments и чувствительные фрагменты transcript/history.

### 8.3 Source of truth

- [x] Документирован master-source для каждого класса знаний.
- [x] Seeded KB и fallback layer не расходятся со structured catalog по section/formula/glossary content на уровне кодовой генерации и regression drift-check.

### 8.4 Legacy cleanup

- [x] UI полностью работает без responseMode.
- [x] Для старых сохранённых сообщений сохранена мягкая совместимость чтения metadata: routing/audit восстанавливают смысл по legacy intent/criterion/fallback markers, если новых полей ещё нет.
- [x] В коде не осталось продуктовой логики, которая считает short/full обязательным пользовательским выбором.

### 8.5 Тесты

- [x] Есть обязательный regression набор для screen/entity/formula/order/privacy cases; текущий детерминированный набор покрывает 30 кейсов.
- [x] Любая будущая правка prompt/routing/catalog может быть проверена без ручного угадывания качества ответа.
- [x] Real-case anonymized fixtures проходят через обязательный golden regression на privacy и semantic markers, а не лежат отдельным артефактом.

## 8.6 Operational validation

- [x] Structured consultant KB и prompt-конфиги успешно засидированы в БД через актуальный seed script.
- [x] Real-case fixture script переведён на DB-only path через POSTGRES_URL/DATABASE_URL и формирует анонимизированный fixture без зависимости от Supabase client key.
- [x] Для real-case golden dataset есть controlled workflow: явный refresh и отдельный drift-check без перезаписи файла.
- [x] Для команды есть единый repo-level quality gate: drift-check real-case fixtures + consultant regression одной командой.

## 9. Не делать

- [ ] Не переопределять уже работающие security guarantees внутри случайных helper-функций вместо boundary-инварианта.
- [ ] Не добавлять новые большие prose-поля как замену нормальной структурной модели.
- [ ] Не объявлять реализованными задачи, которые уже закрыты в коде и не требуют повторной разработки.
- [ ] Не выпускать крупную переработку консультанта без регрессионного набора.

## 10. Риски

- Если не определить master-source, ответы каталога и fallback будут постепенно расходиться.
- Если строить entity routing по prose, качество будет зависеть от формулировки редактора, а не от структуры модели.
- Если оставить тесты опциональными, следующая правка prompt или routing быстро сломает полезность ответов.
- Если не закрыть legacy responseMode, в системе останется мёртвая продуктовая ветка, усложняющая поддержку.

## 11. Итоговое целевое состояние

- Семён отвечает как методолог по всей ОКК, а не как набор summary-подписей.
- Screen answers собираются из структурной модели, пригодной одновременно для routing, seeding, prompt context и regression.
- Privacy и role-based masking защищены на boundary-уровне и подтверждены тестами.
- Fallback layer не живёт отдельно от основного каталога знаний.
- План развития консультанта остаётся актуальным документом, а не архивом уже выполненных задач.