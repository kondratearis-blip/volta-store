# Подключить GitHub к сайту kokoro.com.kg (Cloudflare)

Сайт — это **Cloudflare Worker `kokoro-kgz`** (аккаунт Kondratearis@gmail.com's Account): статика из `site/`
и небольшой серверный код `worker/index.js` — бот курьеров @kkurierr_bot (`/tg/hook`), автоназначение заказов
раз в минуту и погода раз в 10 минут. Настройки — `wrangler.jsonc`.

GitHub подключается **прямо к этому Worker'у**: новый проект и перенос домена не нужны, сайт не останавливается.
Проверено 21.11.2026: Worker, собранный из этого репозитория, байт в байт совпадает с рабочей версией 44.

## Подключение (один раз, ~2 минуты)

1. Cloudflare → **Workers & Pages** → **kokoro-kgz** → **Settings** → раздел **Build** → **Connect**.
2. Выберите **GitHub**. Если Cloudflare попросит — установите приложение Cloudflare на GitHub и дайте ему доступ
   к репозиторию `kondratearis-blip/-` («Only select repositories» → выбрать его).
3. Настройки сборки:

   | Поле | Значение |
   |---|---|
   | Repository | `kondratearis-blip/-` |
   | Branch (рабочая ветка) | `claude/gracious-babbage-3nh4a6` — сайт сейчас в ней (в `main` пока только пустой README) |
   | Build command | пусто |
   | Deploy command | `npx wrangler deploy` (стоит по умолчанию) |
   | Root directory | `/` (пусто) |
   | Builds for non-production branches | выключить |

4. **Connect**. Первая сборка запустится сама или при следующем изменении в ветке; ход — во вкладке **Deployments**.

## Как это работает дальше

- **Изменение в рабочей ветке → сайт обновляется сам** за 1–2 минуты.
- Claude делает правки в своих ветках (`claude/...`); чтобы правка попала на сайт, её вливают в рабочую ветку.
- **Откатить неудачную выкладку:** kokoro-kgz → **Deployments** → прошлая версия → **Rollback**.
- Секрет `WEATHER_SECRET` хранится в Cloudflare (Settings → Variables and Secrets) и при выкладке не стирается.
- **Не выкладывайте больше с компьютера разработки** (`scripts/deploy-cloudflare.mjs`): выкладка оттуда перезапишет
  версию из GitHub. Сначала отправьте папку проекта с того компьютера в этот репозиторий.
- Рабочую ветку можно сменить позже (например, на `main`): kokoro-kgz → Settings → Build → Branch.
