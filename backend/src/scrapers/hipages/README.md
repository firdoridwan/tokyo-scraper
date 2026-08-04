# hipages source module

Everything specific to `hipages.com.au` lives in this folder and nowhere else.
The registry imports `index.js` only, so nothing here is reachable from outside
except through that entry point.

## Files

| File            | Status         | Purpose                                                                            |
| --------------- | -------------- | ---------------------------------------------------------------------------------- |
| `index.js`      | ✅ complete    | Module entry point. Composition only — the sole public surface.                     |
| `descriptor.js` | ✅ complete    | Metadata only: identity, capability flags, supported inputs/outputs.                |
| `selectors.js`  | ⚠️ placeholder | Every selector is `null` with a TODO. Must be filled against the live DOM.          |
| `crawler.js`    | ⛔ stubs       | URL discovery and page fetching. All functions throw.                               |
| `parser.js`     | ⛔ stubs       | Raw markup → loose intermediate objects. All functions throw.                       |
| `extractor.js`  | ⛔ stubs       | Intermediate → normalised records matching `supportedOutputs`. All functions throw. |

## Layer boundaries

The split is not decoration — each layer exists to contain a different kind of
change:

```
crawler   →  which pages exist, how to reach them   (contains: pagination strategy)
parser    →  markup → loose objects                 (contains: DOM/selector churn)
extractor →  loose objects → declared columns       (contains: the output contract)
```

`extractor.js` is the boundary the rest of the application depends on. The
parser may be rewritten wholesale when hipages redesigns; as long as the
extractor still emits the declared columns, repositories, API, and UI are
unaffected.

## Why every selector is `null`

A guessed selector is worse than a missing one: it looks authoritative, passes
review, then silently extracts wrong data or nothing. `null` fails loudly on
first use. Fill them in only after inspecting the live DOM, preferring
`data-*` attributes over semantic elements over structural classes — never
generated/hashed class names.

## Implementation order

1. **`selectors.js`** — inspect the live site, resolve every TODO, set
   `VERIFIED_AT`. Nothing below can be written correctly before this.
2. **`parser.js`** — pure functions over saved HTML fixtures. Start with
   `detectPageGuard`; without it a blocked page parses as "0 results".
3. **`extractor.js`** — normalisation and the `validateRecord` check that keeps
   `supportedOutputs` honest.
4. **`crawler.js`** — the only layer that touches a browser context, which is
   injected rather than created.
5. Flip `implemented: true` in `descriptor.js`. The registry refuses to load the
   module until this is set, so no half-built module can run by accident.

## Adding a different site

Copy this folder's shape, then add one line to `../registry.js`:

```
scrapers/<site>/
  index.js         # entry point — the only file the registry imports
  descriptor.js
  selectors.js
  crawler.js
  parser.js
  extractor.js
```

No route, controller, service, or frontend change is required — the UI builds
its form from the descriptor.

## Legal note

Confirm the site's Terms of Service and `robots.txt` before inspecting or
collecting at volume. Extract publicly listed business information only.
