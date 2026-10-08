# deploy

Конфигурация деплоя https://ktz.perricheno.com (Docker Compose + Cloudflare Tunnel). Код приложения не затрагивает.

- `app` — `node --watch server/index.js`, репозиторий монтируется только для чтения.
- `sync` — каждые 15 с делает `git pull --ff-only` (деплой по коммиту в `main`). Токен читается из `/root/.git-credentials` хоста (`GIT_CREDENTIALS`).
- Порт на хосте: 127.0.0.1:8190 (`KTZ_PORT`); туннель Cloudflare ведёт на него.
- Сервер ждёт `Origin == http://<host>`, за HTTPS это подменяет Transform Rule в Cloudflare.

Запуск: `cd deploy && docker compose up -d`.


## Allur DTAI

Allur runs independently with `docker compose -f deploy/allur-compose.yml up -d factory`, on `127.0.0.1:3280`. This compose project does not manage KTZ containers.

- `/` — 3D factory, live model, detailed workshop panels.
- `/control.html` — monitoring, factors, incidents and comparisons.
- `/ai.html` — Allur DTAI; `/lab.html?run=<id>` opens a scenario in another window.

The agent uses OpenAI Responses with `gpt-5.6-luna`. The API key is read only on the server from the Docker secret `/run/secrets/openai_api_key`; the host secret file is `/root/.config/allur/openai-api-key` (mode 600). It must never be added to the repository or browser assets. Set up this file before starting the compose service. Recreate the Allur service when changing its secret configuration.

The production clock runs automatically at 1:1 and resumes after restart. Public pause, speed and step commands are rejected. `ALLUR_AUTOPLAY=0` is reserved for deterministic test servers. Scenario calculations run in separate workers on a captured copy of the model and never change its clock or configuration. They produce 101 playback frames and a three-seed comparison. JSON scenarios contain validated model commands, not executable OS commands.

The independent `allur_model-data` volume persists the current state, the last eight manual comparisons and the last eight DTAI requests with their replay frames and explanations. Model state is checkpointed every ten seconds and on changes. Do not delete the volume when updating.

Validation: `npm run test:production`, `npm run test:factory`, `npm run test:control`, `npm run test:agent`. Browser tests require Playwright Chromium with WebGL. Agent browser tests use an injected provider fixture and the real simulation engine; they do not use the production secret or bill API requests.
