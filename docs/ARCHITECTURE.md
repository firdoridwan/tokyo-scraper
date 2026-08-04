# Tokyo Scraper — Architecture

Every folder, and why it exists.

---

## 1. Guiding principles

| Principle                       | How it shows up in the code                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **One reason to change**        | Routes route, controllers translate HTTP, services decide, repositories persist. No layer does two jobs.          |
| **Sites are data, not code**    | A website is a *descriptor object* in a registry. The API and UI read it; neither knows hipages exists.            |
| **Seams before implementations**| Persistence and scraping are interfaces with a stub behind them. Filling them in changes one file each.            |
| **Honest placeholders**         | Unbuilt features return `501` and say so in the UI. Nothing simulates work it isn't doing.                         |
| **Config in one place**         | `process.env` is read in exactly one module. Everything else imports typed, defaulted config.                     |

---

## 2. Top level

```
tokyo-scraper/
├── backend/       Express REST API      (npm workspace)
├── frontend/      React SPA             (npm workspace)
├── data/          Runtime artifacts     (gitignored)
├── docs/          This documentation
└── package.json   Workspaces root + orchestration scripts
```

**Why npm workspaces rather than two separate repos or one merged app?**
One `npm install`, one `npm run dev`, and a single lockfile — but the frontend and
backend keep independent `package.json` files, dependency trees, and module systems.
Neither can accidentally import the other's internals, which is what keeps the REST
boundary real rather than nominal.

**Why `data/` at the root, not inside `backend/`?**
It is machine-local runtime state (SQLite file, CSV exports, logs), not source. Keeping
it outside the backend package means wiping `backend/` never destroys extracted data,
and the whole directory is a single gitignore rule.

---

## 3. Backend

```
backend/src/
├── server.js          Process entry: listener, dirs, graceful shutdown
├── app.js             Express assembly: middleware order, mounts
├── config/            Environment + domain constants
├── api/               Routing tree (versioned)
├── controllers/       HTTP ⇄ service translation
├── services/          Business logic
├── repositories/      Persistence interface + drivers
├── scrapers/          Site modules + registry  ← extensibility core
├── middleware/        Cross-cutting request concerns
├── validators/        Zod request schemas
└── utils/             Error type, response envelope, logger, ids
```

### `server.js` vs `app.js`

Split deliberately. `app.js` builds and returns an Express app but never binds a port,
so a test can `import { createApp }` and drive it with supertest without a live socket.
`server.js` owns everything process-shaped: creating runtime directories, listening,
`SIGINT`/`SIGTERM` handling, and last-resort crash handlers.

### `config/`

- **`env.js`** — the only module that touches `process.env`. Coerces types, applies
  defaults, resolves absolute paths, and freezes the result. A typo'd variable name
  becomes a visible default here instead of `undefined` three layers down.
- **`constants.js`** — job statuses, error codes, pagination bounds. These are part of
  the API contract; the frontend mirrors them in `lib/constants.js`.

### `api/` — routing tree

```
api/index.js          mounts /v1  (and /v2 later, side by side)
api/v1/index.js       mounts each resource router
api/v1/routes/*.js    one file per resource
```

Three levels looks like a lot for five resources. It buys two things: a breaking API
change becomes `v2/` next to `v1/` with both serving traffic, and adding a resource
touches exactly one new file plus one `use()` line — never `app.js`.

Route files contain **no logic**. They declare path, validation schema, and handler.
Reading `job.routes.js` tells you the whole job API in fifteen lines.

### `controllers/`

Thin by mandate: read the validated request, call a service, send the envelope. No
business rules, no persistence calls, no conditionals about domain state. This is what
lets services be reused later by a CLI, a cron worker, or a WebSocket handler without
dragging Express along.

### `services/`

Where decisions live.

- **`source.service.js`** — read-only projection of the registry, stripping internals
  (like the lazy `loadScraper` function) before anything reaches HTTP.
- **`job.service.js`** — the lifecycle rules: parameter normalization against a source's
  declared fields, legal state transitions (cancelling a finished job is a `409`, not a
  silent no-op), cascade delete of a job's records.
- **`result.service.js`** — read + export access.
- **`scrapeRunner.service.js`** — **the engine boundary.** Today it logs and parks the
  job. Its documented future job: resolve the adapter, launch Playwright, drive the
  `BaseScraper` lifecycle under a `p-limit` cap, stream progress into the repository.
  Everything upstream of this file is final.

### `repositories/` — the persistence seam

```
repositories/
├── index.js      Factory: picks a driver from config.persistence.driver
├── types.js      JobRepository + ResultRepository interfaces (JSDoc)
├── memory/       In-memory driver — today's default
└── sqlite/       README only. Reserved for better-sqlite3.
```

Services import `jobRepository` and call `findMany`, `update`, `stats` — they never see
a `Map` or a SQL string. Swapping storage means implementing the same interface in
`sqlite/` and adding one `case` to the factory. Every method is **synchronous**, matching
`better-sqlite3`'s API, so the switch requires no `await` churn in callers.

Why ship an in-memory driver at all? Because it makes the skeleton genuinely runnable
and every layer above it genuinely exercised. A `TODO` in place of a repository would
have left the services untested and the UI unbuildable.

### `scrapers/` — the extensibility core

```
scrapers/
├── registry.js              The only module that knows which sites exist
├── types.js                 SourceDescriptor / SourceField typedefs
├── base/BaseScraper.js      Abstract adapter contract (zero Playwright code)
└── hipages/
    ├── hipages.source.js    Descriptor: fields, output columns, capability flags
    ├── hipages.selectors.js DOM selectors, isolated from logic
    └── hipages.scraper.js   ← not built yet
```

This is the folder that makes the product multi-site.

A **descriptor** declares what a website accepts (`category`, `location`, `maxPages`,
`includeDetails`) and what it produces (`businessName`, `phone`, `abn`, …). The registry
holds descriptors. The API serves them. The React form *renders itself* from them.

The practical consequence: adding a second directory is a new folder plus one line in
`registry.js`. No route, controller, service, or component changes. The UI grows a new
source card and a correct form for it without a frontend commit.

**Why selectors live in their own file:** directory sites redesign without warning, and
selectors are the first thing to break. Isolating them makes a site change a one-file
edit instead of an archaeology expedition through extraction logic.

**Why `BaseScraper` contains no Playwright:** it defines *what* a scraper is
(`setup → buildTargetUrls → collectListings → extractDetail → teardown`), not *how*.
The browser context will be injected through the constructor, so adapters stay unit
testable without launching Chromium.

**Why `loadScraper` is lazy:** Playwright stays out of the process image until a job
actually needs it. The API boots fast and stays light.

### `middleware/`

| File                 | Responsibility                                                                |
| -------------------- | ----------------------------------------------------------------------------- |
| `requestContext.js`  | Correlation id per request, echoed as `X-Request-Id`                          |
| `requestLogger.js`   | One line per completed request, with real status and duration                 |
| `validate.js`        | Zod validation at the edge; controllers never see raw input                   |
| `notFound.js`        | Unmatched routes become an `ApiError`, so 404s use the same envelope          |
| `errorHandler.js`    | Single exit point for every failure                                           |

`errorHandler.js` enforces the important distinction: an `ApiError` is *operational*
(expected, safe to show the user) and is surfaced verbatim; anything else is a *bug*,
logged with its stack and returned as a generic 500. Internals never leak.

Correlation ids matter more than usual here — concurrent scrape jobs will interleave
their logs, and `requestId` is what makes a single request traceable through them.

### `validators/`

Zod schemas, one file per resource. Query strings arrive as strings, so numeric fields
use `z.coerce` and carry their own defaults — controllers receive real numbers.

Note what `createJobSchema` deliberately does *not* do: it does not enumerate hipages
fields. `params` is an open record, validated per-source by `jobService` against the
descriptor. Encoding one site's parameters into the shared schema would defeat the
multi-source design.

### `utils/`

`ApiError` (status + machine-readable code + operational flag), `apiResponse` (the one
envelope), `asyncHandler` (rejected promises reach Express instead of hanging the
request), `logger` (levelled, dependency-free, pretty in dev / JSON in prod), `id`
(prefixed UUIDs — `job_9f3c…` is self-describing in logs and can't be mistaken for a
result id).

---

## 4. Frontend

```
frontend/src/
├── main.jsx           Mount only
├── App.jsx            Global providers + router
├── index.css          Tokyo Night design tokens
├── routes/            Route table + navigation model
├── components/
│   ├── ui/            shadcn/ui primitives
│   ├── layout/        AppShell, Sidebar, Topbar, ConnectionStatus
│   ├── common/        Composed app-level building blocks
│   └── scraper/       Feature components for the scrape flow
├── pages/             One file per route
├── hooks/             Data-fetching + UI hooks
├── api/               HTTP client, endpoints, per-resource services
└── lib/               Pure helpers + client-side constants
```

### The `api/` layer

```
api/client.js        The ONLY module that knows fetch, URLs, headers, envelopes
api/endpoints.js     Every path in one catalogue
api/services/*.api.js  One module per backend resource
```

`client.js` unwraps `{ success, data, meta }` once and throws a typed `ApiError` on
failure. Because unwrapping happens here, no component ever writes `response.data.data`,
and adding auth headers, retries, or swapping to axios is a single-file change.

Its network-failure branch is specific on purpose: a dead local backend is the most
common failure in a desktop-style tool, so it produces an actionable message
("Is the backend running?") rather than a generic fetch error.

### `hooks/` — why not TanStack Query?

The app's read pattern is *fetch, show, refetch on demand* — no cache invalidation
graph, no optimistic updates, no offline story. Two small hooks cover it:

- **`useApiQuery`** — runs on mount and on dependency change. Handles the three things
  that are easy to get wrong by hand: aborting in-flight requests when deps change or
  the component unmounts, never calling `setState` after unmount, and keeping previous
  data visible while refetching (no flash of empty).
- **`useApiMutation`** — runs on explicit call, returns the result so callers can
  navigate on success without an effect.

Resource hooks (`useJobs`, `useSources`, `useResults`, `useSystemStatus`) wrap these and
are what pages actually import. If caching becomes a requirement, replacing these two
hooks is the entire migration — pages don't change.

### Component tiers

Three tiers, strictly ordered — a component may only import from tiers below it.

1. **`ui/`** — shadcn/ui primitives (Button, Card, Table, Select, Badge, Alert,
   Progress, Tooltip, Skeleton, Input, Label, Separator). Zero app knowledge. Variants
   are `cva` data, not conditionals, so a new style is one entry rather than a branch
   in JSX.
2. **`common/`** — app-level building blocks: `PageHeader`, `SectionCard`, `StatCard`,
   `StatusBadge`, `DataTable`, `Pagination`, `EmptyState`, `ErrorState`,
   `RouteErrorBoundary`. These encode product conventions (every page header looks the
   same; every list handles loading/empty/error identically).
3. **`layout/` + `scraper/`** — the shell, and feature components for the scrape flow.

**`DataTable` is column-driven** — columns are `{ key, header, render }` objects. That's
why `ResultsPage` can derive its columns at runtime from whatever fields the rows
contain, and why no per-site table component will ever be needed.

**`StatusBadge` reads `JOB_STATUS_META`** rather than switching on status strings.
Adding a status is a constants edit.

### Layout

`AppShell` is mounted as the **layout route**, so the shell renders once and navigation
only swaps the `<Outlet />`. Sidebar state and the polled API connection survive page
changes. The sidebar is a fixed rail at `lg` and a slide-over drawer below it — one
component, two behaviours, so nav links exist in exactly one place.

`Sidebar` and `Topbar` both render from `routes/navigation.js`. Adding a page means one
nav entry and one route entry; the top bar even derives the current page title from the
same model rather than duplicating strings.

`ConnectionStatus` polls `/health` every 15s. A desktop-style tool should never silently
look broken because a local process died.

### Theming

Colors are CSS variables in `index.css` as HSL triplets (`222 47% 11%`, no `hsl()`
wrapper) because Tailwind composes them as `hsl(var(--token) / <alpha>)` — that's what
makes `bg-primary/10` work. `tailwind.config.js` maps semantic names to those variables.

Consequence: no component contains a hex code. Every surface uses `bg-card`,
`border-border`, `text-muted-foreground`. A second theme would be a variables-only change.

| Token         | Hex       | Role                     |
| ------------- | --------- | ------------------------ |
| `background`  | `#0F172A` | App canvas               |
| `card`        | `#111827` | Elevated surfaces        |
| `border`      | `#1E293B` | Dividers, outlines, muted|
| `primary`     | `#3B82F6` | Primary actions          |
| `accent`      | `#60A5FA` | Active nav, links        |
| `success`     | `#22C55E` | Completed states         |
| `destructive` | `#EF4444` | Failures, destructive    |

Restraint is enforced by convention: semantic colors appear as 10–15% alpha fills with
a colored foreground, never as saturated blocks. Shadows are soft and low-contrast. No
glow, no neon.

### Vite dev proxy

The frontend calls same-origin `/api/*`; Vite forwards to `:4000`. No API origin is
baked into the bundle, no CORS in development, and a production deployment behind one
origin behaves identically. `VITE_API_BASE_URL` exists as an escape hatch for a
split-origin deployment.

---

## 5. Request lifecycle, end to end

Pressing **Start Scraping**:

```
ScrapeForm (validates presentationally)
  └─ useCreateJob → jobsApi.create → http.post
      └─ POST /api/v1/jobs
          ├─ requestContext      attach request id
          ├─ cors / helmet / json parsing
          ├─ validate(createJobSchema)      → 422 on bad shape
          ├─ jobController.create           HTTP → service
          ├─ jobService.create
          │   ├─ registry.requireSource()   → 404 on unknown source
          │   ├─ normalizeParams()          apply descriptor defaults → 422 if missing
          │   ├─ jobRepository.create()     persist
          │   └─ scrapeRunner.enqueue()     ← STUB: parks the job as `queued`
          └─ sendSuccess(201, job)
  └─ UI shows "Job queued" + the job id, links to the detail page
```

Everything in that path is production code except the marked line.

---

## 6. Filling in the missing pieces

Each is intentionally isolated. In dependency order:

**1. SQLite persistence** — implement `repositories/sqlite/{connection,migrator,job,result}`
against `repositories/types.js`, add the `case` in `repositories/index.js`, set
`PERSISTENCE_DRIVER=sqlite`. No service or UI change.

**2. hipages scraper** — create `scrapers/hipages/hipages.scraper.js` extending
`BaseScraper`, confirm the selectors in `hipages.selectors.js` against the live DOM, set
`implemented: true`. No registry or UI change.

**3. Scrape engine** — replace the body of `scrapeRunner.service.js`: resolve the adapter
via `registry.loadScraperFor()`, launch Playwright with `config.scraper`, run the
lifecycle under `p-limit`, write progress via `jobRepository.update()` and rows via
`resultRepository.createMany()`. Cancellation already has its `AbortController` map.

**4. CSV export** — implement `resultService.export()` with `csv-writer`, writing to
`config.paths.exports`. The route, validation, and UI button already exist.

**5. Live progress** *(optional)* — the job detail page currently refetches on demand.
Server-Sent Events at `/api/v1/jobs/:id/stream` would slot in behind `useJob` without
touching the page.

---

## 7. Deliberate omissions

Not oversights — decisions for this milestone:

- **No authentication.** Single-user desktop-style tool. The middleware chain has an
  obvious insertion point if that changes.
- **No TypeScript.** JSDoc typedefs give editor completion and document contracts
  without a build step in the backend. The interfaces in `repositories/types.js` and
  `scrapers/types.js` are the parts that actually needed typing.
- **No test suite.** The seams are built for it (`createApp` is importable, services are
  Express-free, repositories are swappable), but tests over stubs test the stubs.
- **No state management library.** Server state is handled by the query hooks; the only
  client state is sidebar open/closed and form values. Redux would be ceremony.
