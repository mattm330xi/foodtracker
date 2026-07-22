# Agents

## Deploy

This is a **Cloudflare Workers** project (not Pages).

**Always push to GitHub before deploying.** Commit and push to `main` — GitHub Actions auto-deploys via `.github/workflows/deploy.yml`.

**Do not run `npm run cf:deploy` manually** — the CI pipeline handles it.

**D1 migrations** are run separately:

```
npx wrangler d1 execute foodtrackerd1 --remote --file migrations/XXXX_name.sql
```

## Build

```
npm run build
```

## Typecheck

```
npm run check
```

Must return **0 errors** before deploying. Warnings (a11y) are acceptable.

## Test

```
npm test
```

Runs all Vitest tests. All must be green before deploying.

Test files:
- `src/lib/barcodeScanner.test.ts` — scanner teardown lifecycle (8 tests)
- `src/lib/timezone.test.ts` — UTC/local conversion, no double-offset (6 tests)
- `src/lib/entries.test.ts` — entries PATCH logic, date filtering (6 tests)
- `src/lib/dateRange.test.ts` — date range bounds for index-friendly queries (5 tests)
- `src/lib/auth.test.ts` — password hashing, registration/login flows, cross-method confirmation (29 tests)

## Known Bugs (Fixed)

- **saveEditEntry timezone double-offset** — Editing any entry (meal, time) corrupted `created_at` by applying the timezone offset twice. Entry would shift to a different UTC date, making it invisible on refresh. Fixed by using `new Date(localDateStr + 'T' + editTime).toISOString()` directly (browser parses as local time).
- **addEntry / updateEntry missing error handling** — Local state was updated even when server rejected the request. On refresh, the unpersisted optimistic entry disappeared. Fixed by checking `res.ok` before updating local state.
- **saveEditEntry fire-and-forget** — Two separate PATCH calls were not awaited, causing race conditions on quick refresh. Fixed by combining into a single awaited PATCH with both `meal` and `created_at`.
- **qr-scanner not detecting 1D barcodes** — qr-scanner library optimized for QR codes, failed to detect UPC-A/EAN-13 on mobile. Fixed by switching to Native BarcodeDetector API with explicit food barcode formats.

## Architecture Rules

- **Cloudflare Workers** — NOT Pages. Deploy with `wrangler deploy`, not `wrangler pages deploy`
- **D1 binding:** `FTD1` → database `foodtrackerd1` (id: `63d158c5-e98c-4ef5-904d-3452bcd6711e`)
- **Assets binding:** `ASSETS` — required by `@sveltejs/adapter-cloudflare@4`
- **Session cookie:** `ft_session={userId}:{token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=5184000`
- **WebAuthn RP_ID:** Derived dynamically from request origin, not hardcoded
- **All timestamps:** ISO 8601 UTC strings (`new Date().toISOString()`)
- **Photos:** Base64 JPEG in D1, compressed client-side to max 800px @ 0.6 quality
- **Service worker:** Cache name `foodtracker-v5` — bump on deploy to force cache invalidation
- **Vitest config:** Uses `@sveltejs/vite-plugin-svelte` (NOT `@sveltejs/kit/vite`) with `resolve.conditions: ['browser']` to get Svelte client build
- **wrangler:** v4.x (`@sveltejs/adapter-cloudflare@4` requires it)

## Database Schema (D1)

Migrations in `migrations/` directory. Key tables:

- `users` — id, username, timezone, **password_hash** (PBKDF2-SHA256, nullable)
- `sessions` — user_id, token, expires_at
- `entries` — id, text, image, meal, created_at, user_id, day_notes, **barcode_data** (JSON)
- `reactions` — id, symptom, severity, notes, created_at, user_id
- `favorites` — id, text, image, meal, use_count, user_id
- `meal_templates` — id, name, items, user_id
- `credentials` — WebAuthn credentials (user_id, credential_id, public_key, counter)
- **`user_allergens`** — id, user_id, ingredient (UNIQUE per user)

### barcode_data (JSON stored in entries.barcode_data)

```json
{
  "name": "Product Name",
  "brand": "Brand",
  "ingredients": "Full ingredients text",
  "allergens": ["milk", "soy"],
  "image": "https://...",
  "barcode": "0123456789012",
  "warnings": ["garlic", "onion"]
}
```

`warnings` contains the user's allergens that were found in the product's ingredients text. Stored at scan time so they persist even if the user's allergen list changes.

## BarcodeScanner (Native BarcodeDetector API)

Zero-dependency barcode scanner using the browser-native `BarcodeDetector` API. No third-party library — just `getUserMedia` + `requestAnimationFrame` + `BarcodeDetector.detect()`.

**`BarcodeScanner.svelte` component:**
- Props: `elementId` (default `'barcode-reader'`), `onBarcode` callback
- Exports: `startScanner()`, `stopScanner()`
- Renders a `<video>` element for the camera feed
- `startScanner()`: checks `BarcodeDetector` availability, creates detector with food formats (`upc_a`, `upc_e`, `ean_13`, `ean_8`), opens camera via `getUserMedia`, starts `requestAnimationFrame` scan loop
- `stopScanner()`: `cancelAnimationFrame` + `track.stop()` + null ref — synchronous, clean teardown
- `scanFrame()`: called via rAF, calls `detector.detect(video)`, debounces duplicate codes (3s), enforces 2s scan cooldown, calls `onBarcode` on match
- `onDestroy`: cancels rAF, stops all tracks
- Fallback message for browsers without `BarcodeDetector` (Safari < 15.4, older desktop)

**Barcode lookup flow (`/api/barcode`):**
1. Looks up product on OpenFoodFacts API
2. If user is authenticated, checks product ingredients against `user_allergens` table
3. Returns `warnings` array with matching allergens
4. Parent stops scanner on success (prevents re-detection flicker)

**Manual barcode entry:** Modal includes a text input below the camera for typing barcode numbers directly when camera scanning fails.

**Adding entries to past/future dates:** POST `/api/entries` accepts an optional `date` field (YYYY-MM-DD). If provided, the entry's `created_at` is set to that date at the current time-of-day in the user's timezone. The client shows a confirmation modal for non-today dates (gentle for past, stronger for future). `skipPastWarning` is persisted to localStorage.

## Allergen System

- **Profile page** (`/profile`): Add/remove allergens (comma-separated input supported)
- **Table:** `user_allergens` — one row per ingredient per user, UNIQUE constraint
- **API:** `GET/POST/DELETE /api/allergens` — CRUD, requires auth
- **Barcode scan:** `/api/barcode` reads session cookie, queries allergens, returns `warnings` array
- **Fuzzy matching:** `normalize()` strips punctuation, `fuzzyMatch()` does bidirectional substring + Levenshtein distance (≤2 edit distance for tokens ≥4 chars) to catch typos like "galric" → "garlic"
- **Scan result modal:** Orange banner `⚠️ Contains: garlic, onion` — non-blocking
- **Saved entries:** Orange border + persistent warning banner on entries with allergen matches

## Svelte 5 Conventions

- Use runes: `$state`, `$effect`, `$derived`, `$props`
- No `onMount` for async — use `$effect` with async function
- Component exports: `export { functionName }` to expose methods to parent
- `@testing-library/svelte` 5.x: `render()` returns `{ component, container }`
- `component.startScanner()` calls exported functions on the component instance

## Agent Coding Rules

### 1. Teardown Laws (Native BarcodeDetector)
- **`cancelAnimationFrame` + `track.stop()` are synchronous** — safe to call in `onDestroy()` without async wrapping
- **Guard re-entry** — check `isTransitioning` and null-ref before teardown
- **Graceful Rejection Swallowing:** Wrap teardown calls in `try/catch` blocks so mid-flight navigation never throws

### 2. Anti-Patterns (Strictly Forbidden)
- **NO Franken-Hacks:** NEVER manually manipulate DOM nodes (e.g., `element.innerHTML = ''`), force-kill MediaStream tracks, or mutate library internals unless the library's native async methods have failed and you are explicitly instructed to write a fallback.
- **NO Callback Variable Nulling:** Nulling out local variables does NOT unbind event handlers already passed to third-party library closures. To block execution during unmount, check an explicit boolean flag (`if (isStopping) return;`) at the top of the callback.
- **NO Unhandled Async `onDestroy` Hooks:** Svelte's `onDestroy` hook runs synchronously. Never launch fire-and-forget Promises inside `onDestroy`.

### 3. UI State & Network Lookups
- **Always Include Timeouts:** Every `fetch` request triggered by real-time hardware events (like a barcode scan) MUST be wrapped in an `AbortController` with a clear timeout (default 5000ms).
- **`finally` State Resets:** Always reset UI pending state flags (`isBusy = false`, `isLoading = false`) inside a `finally` block to guarantee spinners clear on HTTP 404s, timeouts, or network drops.
- **Human-Readable Errors:** Differentiate hardware access errors (camera permission) from API lookup errors (product not found, timeout) in the UI.

### 4. Verification Protocol Before Outputting Code
Before outputting any Svelte component or TS module:
1. Check that every `async` call is properly awaited or handled with `.catch()`.
2. Verify that local guard flags (`isTransitioning`, `isStopping`) prevent re-entrant calls to initialization/teardown functions.
3. Run `tsc --noEmit` or `npm run check` mentally to verify that imports, types, and function arguments match the exact declarations in `node_modules`.
4. Don't forget to commit, deploy, and update docs too.

### 5. Cleanup & Documentation
- **README.md must be updated** after any feature addition, removal, or architecture change. Check it as part of cleanup before deploying.
- **Push to GitHub before deploying.** Commit, push, then deploy. Never deploy uncommitted code.

### 6. Database Query Patterns
- **Never use `date(created_at)` in WHERE clauses** — it wraps the indexed column in a function, preventing index usage. Use range comparisons instead: `created_at >= ? AND created_at < ?` with ISO timestamps.
- **Use `src/lib/dateRange.ts`** — `dateRange('2026-07-21')` returns `{ start, end }` ISO bounds for index-friendly date queries.
- **All date queries must use the composite index** — `idx_entries_user(user_id, created_at DESC)` and `idx_reactions_user(user_id, created_at DESC)` are only usable when `created_at` is compared directly, not wrapped in functions.
- **Check indexes before adding new queries** — if filtering/sorting on a column, verify an index exists. Add migration if needed.

### 5. Logging Rules
- **NO `console.log`, `console.warn`, `console.info`** in production code
- **`console.debug`** allowed only for barcode debugging (gated behind debug flag)
- **`console.error`** allowed only in error handlers

## Session Persistence Across Deploys

Sessions are stored in D1 (persists across deploys) with `Secure` cookie flag. If sessions are lost after deploy:
1. Check cookie `Domain` attribute matches deployment domain
2. Check service worker isn't serving stale cached API responses
3. Verify D1 database binding is correct in `wrangler.toml`
