# OKK Gold Standards Index

Этот каталог содержит "Золотые стандарты" проекта — основные правила и требования к архитектуре, дизайну и безопасности.

### 🌐 Информация о проекте
*   **Домен:** [okk24.online](https://okk24.online)
*   **Тип:** B2B SaaS (Отдел Контроля Качества)
*   **Стек:** Next.js, PostgreSQL, AI (OpenAI), S3, Банк Точка
*   **Хостинг:** Выделенный сервер VDS/VPS (Timeweb Cloud)
*   **Оркестрация:** Docker Compose (изолированные контейнеры Next.js Standalone и Caddy Proxy)
*   **Прокси и SSL:** Caddy Server с установленным коммерческим Wildcard SSL-сертификатом (*.okk24.online) и авто-редиректом HTTP ➡️ HTTPS

### 🗺 Навигация по стандартам

| Файл | Описание | Область ответственности (SCOPE) |
| :--- | :--- | :--- |
| [GOLD_DATABASE_SQL.md](./GOLD_DATABASE_SQL.md) | База данных и SQL | Схемы таблиц, PostgreSQL, типы данных, Soft Deletes. |
| [GOLD_UI_TABLES.md](./GOLD_UI_TABLES.md) | **Пользовательские таблицы** | Верстка, UX, фильтры, Sticky Header, зебра, индикаторы статусов. |
| [GOLD_DESIGN_UX.md](./GOLD_DESIGN_UX.md) | Дизайн и UI | Metro Design, цвета, отступы, шрифты, отсутствие скруглений. |
| [GOLD_SECURITY_STANDARDS.md](./GOLD_SECURITY_STANDARDS.md) | Безопасность | Auth, Middleware, RBAC, защита роутов. |
| [GOLD_API_AND_BACKEND.md](./GOLD_API_AND_BACKEND.md) | Бэкенд и API | Next.js API, Server Actions, форматы JSON-ответов, валидация. |
| [GOLD_FRONTEND_ARCHITECTURE.md](./GOLD_FRONTEND_ARCHITECTURE.md) | Архитектура фронтенда | React-компоненты, структура папок, состояние. |
| [GOLD_GIT_AND_WORKFLOW.md](./GOLD_GIT_AND_WORKFLOW.md) | Процесс разработки | Git branches, Conventional Commits, Pull Requests. |
| [GOLD_KNOWLEDGE_BASE_RAG.md](./GOLD_KNOWLEDGE_BASE_RAG.md) | База знаний AI | Правила подготовки данных для AI-консультанта. |
| [GOLD_INTEGRATIONS_WEBHOOKS.md](./GOLD_INTEGRATIONS_WEBHOOKS.md) | Интеграции | Работа с внешними CRM и вебхуками. |

> [!TIP]
> Всегда проверяй SCOPE файла перед внесением изменений или использованием его как эталона.
