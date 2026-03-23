# RunningRehab MVP

MVP для тренера и спортсменов:

- ручное создание учеток админом
- роли `admin`, `trainer`, `athlete`
- логин по `username/password`
- привязка Strava только для спортсмена
- подтягивание только новых тренировок после привязки
- простые кабинеты для администратора, тренера и спортсмена

## Локальный запуск

1. Скопировать `.env.example` в `.env`
2. Заполнить `JWT_SECRET`, `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_TOKEN_ENCRYPTION_KEY`
3. Установить зависимости:

```bash
npm install
```

4. Запустить Postgres любым удобным способом или через Docker Compose
5. Запустить dev-режим:

```bash
npm run dev
```

## Первый админ

После первого запуска первый админ создается автоматически из `.env`:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_FULL_NAME`

Автосоздание происходит только если в базе еще нет ни одного админа.

## Прод

```bash
docker compose up -d --build
```

Для production `STRAVA_TOKEN_ENCRYPTION_KEY` обязателен: он используется для шифрования `access_token` и `refresh_token` Strava в базе.
