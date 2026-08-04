# Roadmap

## ✅ Milestone 1 — Application skeleton (done)

- [x] npm workspaces monorepo, single `npm run dev`
- [x] Express app with versioned `/api/v1`, envelope, error handling, Zod validation
- [x] Scraper registry + `SourceDescriptor` contract + hipages descriptor
- [x] `BaseScraper` abstract contract (no Playwright)
- [x] Repository interfaces + in-memory driver
- [x] React SPA: shell, routing, navigation, 7 pages
- [x] Tokyo Night theme via CSS variables + shadcn/ui primitives
- [x] `POST /jobs` accepts, validates, persists, and queues real jobs

## Milestone 2 — Persistence

- [ ] `repositories/sqlite/connection.js` — better-sqlite3 handle, WAL pragma
- [ ] `migrations/001_initial_schema.sql` — `jobs`, `results` + indexes
- [ ] `migrator.js` — apply pending migrations on boot
- [ ] `job.sqlite.repository.js` / `result.sqlite.repository.js`
- [ ] Add the `sqlite` case in `repositories/index.js`; default `PERSISTENCE_DRIVER=sqlite`

## Milestone 3 — hipages scraper

- [ ] Confirm every selector in `hipages.selectors.js` against the live DOM
- [ ] `hipages.scraper.js` extending `BaseScraper`
- [ ] Pagination + detail-page enrichment
- [ ] Captcha/block detection using the `guards` selectors
- [ ] Flip `implemented: true` in the descriptor

## Milestone 4 — Scrape engine

- [ ] Playwright browser/context pool in `scrapeRunner.service.js`
- [ ] `p-limit` concurrency + configurable request delay
- [ ] Progress streaming into `jobRepository.update()`
- [ ] Retry with backoff (`SCRAPER_MAX_RETRIES`)
- [ ] Wire the existing `AbortController` cancellation path

## Milestone 5 — Export

- [ ] `resultService.export()` with `csv-writer` → `data/exports/`
- [ ] JSON export
- [ ] Download response (`Content-Disposition`) instead of `501`

## Milestone 6 — Polish

- [ ] SSE at `/api/v1/jobs/:id/stream` for live progress
- [ ] Deduplication across jobs
- [ ] Per-source rate limits in settings
- [ ] Test suite (supertest over `createApp`, unit tests over services)
