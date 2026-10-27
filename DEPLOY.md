# Запуск сайта на своём домене

Сайт статический (один `index.html` + папка `media/`), подходит любой хостинг.

## 1. Купить домен
Например `mkgroup.kg` — у любого регистратора доменов .kg, или `.com` у любого международного регистратора.

## 2. Хостинг (бесплатно) — вариант A: Netlify
1. Зайти на netlify.com → Add new site → Import from GitHub → выбрать этот репозиторий и ветку.
2. Build command — пусто, Publish directory — `/`.
3. Domain management → Add custom domain → ввести домен.
4. У регистратора прописать DNS-записи, которые покажет Netlify. HTTPS включится автоматически.

## Вариант B: GitHub Pages
1. Слить ветку в `main`. Репозиторий должен быть публичным (или тариф GitHub Pro).
2. Settings → Pages → Source: Deploy from a branch → `main` / `(root)`.
3. Settings → Pages → Custom domain → ввести домен (создастся файл `CNAME`), включить Enforce HTTPS.
4. У регистратора добавить DNS:
   - `A` для `@`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   - `CNAME` для `www`: `<ваш-логин>.github.io`

## 3. Перед запуском
- Заполнить `CONFIG` (телефон, WhatsApp, Telegram) и `PROJECTS` в `index.html`.
- Добавить фото/видео в `media/` и прописать в `MEDIA`.
- По желанию указать `CONFIG.leadEndpoint` — адрес CRM/бота для заявок.
