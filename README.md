# Недвижимость Твери — Scout

Первый автоматический сборщик проекта «ТВЕРЬ.НЕДВИЖИМОСТЬ».

## Что делает
1. Запускается по расписанию Render Cron.
2. Читает разрешённые RSS/Atom-источники.
3. Нормализует материалы.
4. Удаляет дубли внутри запуска.
5. Передаёт материалы в Supabase Edge Function `agent-scout-ingest`.

## Важно
Источники в `src/sources.js` пока заведены как каталог. `feedUrl` намеренно не заполнен: для каждого сайта сначала нужно определить официальный RSS/Atom/API или иной разрешённый способ доступа. Не обходим robots.txt и ограничения сайтов.

## Render
`render.yaml` создаёт Cron Job в Frankfurt с запуском каждые 15 минут.

Секреты: `SCOUT_INGEST_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Service Role Key никогда не коммитим в Git.

## Следующий этап
Подключить официальные RSS/API, добавить фильтр по Твери, затем Factchecker → Analyst → Editor → ручное approve → Telegram.

## v0.2 update
RSS of Afanasy has been discovered in a public RSS catalog, but direct reachability from Render is not yet verified. Scout now filters real-estate and housing-related news, and the ingest payload matches the deployed Supabase Edge Function (`items` with snake_case keys). Run logs should show `source_filtered` and `run_complete`. A successful run with zero items is not evidence of ingestion. Do not enable Telegram autopublishing yet. If the feed is unavailable, check `source_error` logs before changing URLs.
