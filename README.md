# Tokyo Scraper

Professional desktop-style web application for extracting public business information
from directory websites.

First supported source: [hipages.com.au](https://hipages.com.au). The architecture is
source-agnostic — additional directories plug in without touching the API or UI.

> **Status: working end to end.**
> Paste a hipages category URL, pick a scraping mode, and the run walks the whole
> category, opens every business profile, visits the websites that are listed,
> extracts an email where one is published, and writes a CSV and an Excel
> workbook you can download. Runs happen in the background; the UI follows them
> by polling.
>
> Jobs are held in memory, so a backend restart clears the job list. The files it
> has already written stay on disk under `data/exports/`.

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
**Backend** — Node.js, Express, Zod, Playwright (scraping), ExcelJS + csv-writer (exports)
**Transport** — REST, versioned at `/api/v1`

`better-sqlite3` is installed but unused: the persistence seam exists and the
SQLite driver behind it has not been written. The job store is in memory.

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
| `GET`    | `/results/export`    | Download a run's file: `?jobId=…&format=csv\|xlsx` |

Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": {}, "meta": { "pagination": {} } }

// failure
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "details": {} } }
```

---

## How a run works

`POST /jobs` validates the input, normalizes it against the source descriptor,
records the job, and answers immediately with it `queued`. The scrape then runs
in the background and writes its progress onto the job record, which the UI
polls every two seconds.

```
category URL
  → crawler        walks the directory's "View More" pages until exhausted
  → processor      opens each profile, parses it, visits the website if listed
  → extractor      reads one email address off the captured homepage
  → exporters      one CSV + one XLSX under data/exports/
```

Every discovered company is processed in both scraping modes. The mode decides
only which of them reach the files:

| Scraping mode               | Exports                                        |
| --------------------------- | ---------------------------------------------- |
| All Companies (default)     | Every company that did not error                |
| Only Companies With Email   | Only companies with a valid email address       |

A run ends when hipages runs out of companies, or when you cancel it. Cancelling
stops it between companies and writes no files.

### Still not built

| Feature       | Status | Where it attaches                    |
| ------------- | ------ | ------------------------------------ |
| SQLite driver | Absent | `backend/src/repositories/sqlite/`    |
| Per-row storage | Absent | `resultRepository` — runs export to file, not to the record store |
| Listing-page route | Stub | `scrapers/hipages/extractor.js`, `selectors.js` |

---

## Adding a new directory website

1. Create `backend/src/scrapers/<site>/descriptor.js` — metadata only, declaring the
   site's input fields and output columns.
2. Register it in `backend/src/scrapers/registry.js` (one line).
3. Done. The API exposes it, and the UI renders its form automatically from the
   descriptor — no frontend change.

Adding the *scraper implementation* is a separate, isolated step: a `crawler.js`
and `parser.js` alongside the descriptor, then `implemented: true`. See
`backend/src/scrapers/hipages/` for the worked example.

---

## Legal note

Extract only publicly available business information, and check the target site's
Terms of Service and `robots.txt` before running against it. The scraper defaults
(`SCRAPER_REQUEST_DELAY_MS`, `SCRAPER_CONCURRENCY`) are deliberately conservative.
