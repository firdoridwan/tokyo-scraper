# Tokyo Scraper

Professional desktop-style web application for extracting public business information
from directory websites.

First supported source: [hipages.com.au](https://hipages.com.au). The architecture is
source-agnostic — additional directories plug in without touching the API or UI.

> **Current milestone: application skeleton.**
> The full stack runs end to end — routing, API, validation, job queue, persistence
> seam, and UI. The Playwright scraping engine, SQLite driver, and CSV exporter are
> deliberately not built yet. Every place they attach is marked and documented.

---

## Quick start

```bash
npm install          # installs both workspaces
cp backend/.env.example backend/.env
npm run dev          # API on :4000, UI on :5173
```

Open <http://localhost:5173>.

| Command            | Effect                                       |
| ------------------ | -------------------------------------------- |
| `npm run dev`      | Backend + frontend concurrently               |
| `npm run dev:api`  | Express API only (`node --watch`)             |
| `npm run dev:web`  | Vite dev server only                          |
| `npm run build`    | Production frontend build → `frontend/dist`   |
| `npm start`        | Run the API in production mode                |

---

## Stack

**Frontend** — React 18, Vite, TailwindCSS, shadcn/ui, Lucide, React Router
**Backend** — Node.js, Express, Zod (Playwright + better-sqlite3 installed, not yet wired)
**Transport** — REST, versioned at `/api/v1`

---

## Repository layout

```
tokyo-scraper/
├── backend/          Express REST API
├── frontend/         React single-page application
├── data/             Runtime artifacts (database, exports, logs) — gitignored
├── docs/             Architecture documentation
└── package.json      npm workspaces root
```

Detailed rationale for every folder: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## API

Base: `http://localhost:4000/api/v1`

| Method   | Endpoint             | Purpose                                    |
| -------- | -------------------- | ------------------------------------------ |
| `GET`    | `/health`            | Liveness + subsystem readiness             |
| `GET`    | `/stats`             | Dashboard counters                         |
| `GET`    | `/sources`           | Registered directory websites              |
| `GET`    | `/sources/:id`       | One source descriptor (drives the UI form) |
| `POST`   | `/jobs`              | Create + queue a scrape job                |
| `GET`    | `/jobs`              | Paginated, filterable job list             |
| `GET`    | `/jobs/:id`          | Job detail                                 |
| `POST`   | `/jobs/:id/cancel`   | Cancel a queued/running job                |
| `DELETE` | `/jobs/:id`          | Delete a job and its records               |
| `GET`    | `/jobs/:id/results`  | Records for one job                        |
| `GET`    | `/results`           | Records across all jobs                    |
| `GET`    | `/results/export`    | Reserved — returns `501` until built       |

Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": {}, "meta": { "pagination": {} } }

// failure
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "details": {} } }
```

---

## What "not implemented yet" means

These are wired but intentionally inert, and the app tells you so at runtime:

| Feature          | Status | Where it attaches                                     |
| ---------------- | ------ | ----------------------------------------------------- |
| Playwright engine| Stub   | `backend/src/services/scrapeRunner.service.js`         |
| hipages scraper  | Absent | `backend/src/scrapers/hipages/hipages.scraper.js`      |
| SQLite driver    | Absent | `backend/src/repositories/sqlite/`                     |
| CSV export       | Stub   | `backend/src/services/result.service.js` → `export()`  |

`POST /jobs` is real: it validates input, normalizes parameters against the source
descriptor, persists the job, and queues it. The job stays `queued` because no engine
consumes the queue yet — no fake progress, no fabricated rows.

---

## Adding a new directory website

1. Create `backend/src/scrapers/<site>/<site>.source.js` — a descriptor declaring the
   site's input fields and output columns.
2. Register it in `backend/src/scrapers/registry.js` (one line).
3. Done. The API exposes it, and the UI renders its form automatically from the
   descriptor.

Adding the *scraper implementation* is a separate, isolated step:
`<site>.scraper.js` extending `BaseScraper`, then `implemented: true`.

---

## Legal note

Extract only publicly available business information, and check the target site's
Terms of Service and `robots.txt` before running against it. The scraper defaults
(`SCRAPER_REQUEST_DELAY_MS`, `SCRAPER_CONCURRENCY`) are deliberately conservative.
