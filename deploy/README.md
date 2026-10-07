# deploy

Конфигурация деплоя https://ktz.perricheno.com (Docker Compose + Cloudflare Tunnel). Код приложения не затрагивает.

- `app` — `node --watch server/index.js`, репозиторий монтируется только для чтения.
- `sync` — каждые 15 с делает `git pull --ff-only` (деплой по коммиту в `main`). Токен читается из `/root/.git-credentials` хоста (`GIT_CREDENTIALS`).
- Порт на хосте: 127.0.0.1:8190 (`KTZ_PORT`); туннель Cloudflare ведёт на него.
- Сервер ждёт `Origin == http://<host>`, за HTTPS это подменяет Transform Rule в Cloudflare.

Запуск: `cd deploy && docker compose up -d`.
