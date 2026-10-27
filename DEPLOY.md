# Запуск сайта в интернете

Сайт статический (`index.html` + папка `media/`), сборка не нужна.

## 1. Публикация на Netlify (бесплатно, ~5 минут)
1. Зарегистрируйтесь на https://app.netlify.com (можно через GitHub).
2. **Add new site → Import an existing project → GitHub** и дайте Netlify доступ к репозиторию `kondratearis-blip/-`.
3. Выберите ветку `claude/adoring-bardeen-un37uy` (или `main`, если ветка уже слита).
4. Настройки сборки подтянутся из `netlify.toml` — просто нажмите **Deploy**.
5. Сайт появится по адресу вида `https://<имя>.netlify.app`. Имя можно сменить: **Site configuration → Change site name** (например `mkgroup`).

Каждый новый push в выбранную ветку автоматически обновляет сайт.

## 2. Свой домен (например mkgroup.kg)
1. Купите домен у регистратора.
2. В Netlify: **Domain management → Add a domain** → введите домен.
3. У регистратора пропишите DNS-записи, которые покажет Netlify (или смените NS-серверы на Netlify DNS).
4. HTTPS включится автоматически.

## 3. Перед публичным запуском
- Заполните `CONFIG` (телефон, WhatsApp, Telegram) и `PROJECTS` (реальные ЖК, цены, сроки) в `index.html`.
- Замените цифры компании в блоке «О компании».
- Добавьте фото/видео в `media/` и пропишите в `MEDIA`.
- Укажите `CONFIG.leadEndpoint`, если заявки должны идти в CRM/бота (иначе они уходят в WhatsApp).
- Когда все данные реальные — поставьте `draft: false`, чтобы убрать плашку «черновик».
