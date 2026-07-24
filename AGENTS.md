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
- `src/lib/barcodeScanner.test.ts` — scanner teardown lifecycle, stale-detection race (9 tests)
- `src/lib/timezone.test.ts` — UTC/local conversion, no double-offset (6 tests)
- `src/lib/entries.test.ts` — entries PATCH logic (meal/created_at/text/allergen_warnings, any combination), date filtering (11 tests)
- `src/lib/dateRange.test.ts` — timezone-aware date range bounds, zonedTimeToUtc DST handling, shiftDateStr, isoToLocalDateStr (24 tests)
- `src/lib/stats.test.ts` — stats endpoint local-day bucketing (4 tests)
- `src/lib/favorites.test.ts` — favorites CRUD, toggle flow, client-side isFavorited logic (16 tests)
- `src/lib/pwaInstall.test.ts` — PWA install banner, platform detection, dismissal (14 tests)
- `src/lib/auth.test.ts` — password hashing, registration/login flows, cross-method confirmation, needsPasskey, multi-device sessions (34 tests)
- `src/lib/allergenMatch.test.ts` — allergen fuzzy-matching: exact/compound/misspelling cases, false-positive regressions (22 tests)

## Known Bugs (Fixed)

- **saveEditEntry timezone double-offset** — Editing any entry (meal, time) corrupted `created_at` by applying the timezone offset twice. Entry would shift to a different UTC date, making it invisible on refresh. Fixed by using `new Date(localDateStr + 'T' + editTime).toISOString()` directly (browser parses as local time).
- **addEntry / updateEntry missing error handling** — Local state was updated even when server rejected the request. On refresh, the unpersisted optimistic entry disappeared. Fixed by checking `res.ok` before updating local state.
- **saveEditEntry fire-and-forget** — Two separate PATCH calls were not awaited, causing race conditions on quick refresh. Fixed by combining into a single awaited PATCH with both `meal` and `created_at`.
- **qr-scanner not detecting 1D barcodes** — qr-scanner library optimized for QR codes, failed to detect UPC-A/EAN-13 on mobile. Fixed by switching to Native BarcodeDetector API with explicit food barcode formats.
- **Sessions weren't actually rolling** — `expires_at` was only ever set at login/register time and never touched again, so an active user still got logged out 60 days after their *last login* rather than their *last activity*. Fixed in `hooks.server.ts`: every authenticated request now pushes both the `sessions.expires_at` row and the `ft_session` cookie's `Max-Age` another 60 days out.
- **Logging in on a second device silently logged out the first** — `login-password`, `login-finish` (passkey), and `logout` all ran `DELETE FROM sessions WHERE user_id = ?`, wiping every session for the account, not just the one being replaced. The app now supports multiple concurrent sessions per user (intentional — no single-session enforcement): `login-finish` only clears its own `auth:%` challenge session, `login-password` doesn't delete anything before inserting, and `logout` deletes only the calling device's own `(user_id, token)` row.
- **Entries added in the evening landed on "tomorrow"** — `dateRange(dateStr)` computed UTC-midnight-aligned bounds (`${dateStr}T00:00:00.000Z` .. `+1 day`), but callers treated `dateStr` as the user's *local* calendar day. In a UTC-negative timezone (e.g. `America/New_York`), an entry created in the evening has a `created_at` past UTC midnight — correct UTC, but outside the naive UTC-day range for the local date the user actually experienced, so it appeared under the next day instead. Fixed by rewriting `dateRange.ts` to take a `timezone` parameter and compute true local-midnight-to-local-midnight bounds via `Intl.DateTimeFormat` offset lookups (`zonedTimeToUtc`, DST-aware with a two-pass refinement). All callers (`entries`, `reactions`, `day-notes`, `stats` API routes) now pass `locals.timezone`. Also fixed a related bug in `entries` POST: when a `date` was explicitly provided (e.g. backdating an entry), the current time-of-day was labeled as UTC without converting it (`` `${date}T${timePart}.${ms}Z` ``) — now correctly converted via `zonedTimeToUtc`. Client-side `shiftDay()` and `formatDateDisplay()` in `+page.svelte` also had timezone-inconsistent `Date` parsing, fixed to use pure calendar-math (`shiftDateStr`) and UTC-noon anchors respectively so they can't drift a day depending on the browser's own timezone.

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
- `entries` — id, text, image, meal, created_at, user_id, day_notes, **barcode_data** (JSON), **allergen_warnings** (JSON array, manually flagged)
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
- `scanFrame()`: called via rAF, calls `detector.detect(video)`, debounces duplicate codes (3s), enforces 2s scan cooldown, calls `onBarcode` on match. Captures the in-scope `detector` as `activeDetector` before awaiting `detect()`, then re-checks `detector === activeDetector && stream` after — if `stopScanner()` ran while `detect()` was in flight, the stale result is discarded instead of calling `onBarcode` again. Without this, a barcode found right as the scanner stops could re-fire the callback and flicker the parent's UI back into "looking up".
- `onDestroy`: cancels rAF, stops all tracks
- Fallback message for browsers without `BarcodeDetector` (Safari < 15.4, older desktop)

**Barcode lookup flow (`/api/barcode`):**
1. Looks up product on OpenFoodFacts API
2. If user is authenticated, checks product ingredients against `user_allergens` table
3. Returns `warnings` array with matching allergens
4. Parent stops scanner on success (prevents re-detection flicker) and, in `+page.svelte`, unmounts `<BarcodeScanner>` entirely once `scannerStatus === 'success'` — leaving it mounted with a stopped stream showed a black video box next to the result.

**Manual barcode entry:** Modal includes a text input below the camera for typing barcode numbers directly when camera scanning fails.

**Adding entries to past/future dates:** POST `/api/entries` accepts an optional `date` field (YYYY-MM-DD). If provided, the entry's `created_at` is set to that date at the current time-of-day in the user's timezone. The client shows a confirmation modal for non-today dates (gentle for past, stronger for future). `skipPastWarning` is persisted to localStorage.

**Add Entry with nothing attached:** clicking Add Entry with no text and no photo no longer silently no-ops. `addEntry()` sets `showEmptyEntryPrompt = true` instead, showing a dialog with "Add Photo" (triggers the hidden camera `<input>`) and "Scan Barcode" (opens `showBarcode`) options.

**Editing an entry (pencil icon):** `startEditEntry`/`saveEditEntry` in `+page.svelte` open a single inline form covering note text, meal slot, and time together — not just meal/time. PATCH `/api/entries` accepts `meal`, `created_at`, and `text` independently or in any combination; it builds the `UPDATE` clause dynamically from whichever fields are present rather than branching on fixed combinations.

## Allergen System

- **Settings drawer** (opened from the main page, not a route): Add/remove allergens (comma-separated input supported)
- **Table:** `user_allergens` — one row per ingredient per user, UNIQUE constraint
- **API:** `GET/POST/DELETE /api/allergens` — CRUD, requires auth
- **Barcode scan:** `/api/barcode` reads session cookie, queries allergens, returns `warnings` array
- **Fuzzy matching (`src/lib/allergenMatch.ts`):** `normalize()` replaces punctuation with a space (not deletes it, so "garlic)" or "corn/masa" don't merge into one token) before tokenizing. `fuzzyMatch()` requires every word of a multi-word allergen (e.g. "peanut butter") to appear somewhere in the ingredients — matching on just one word was a false-positive source. Per-token matching (`tokenMatches`) is intentionally conservative to avoid flagging allergens that aren't actually present: exact match; one-directional compound-word containment for allergen tokens ≥3 chars (allergen inside a longer ingredient word, e.g. "soy" in "soybean" — never the reverse); and Levenshtein distance ≤1 for typos, only between tokens ≥4 chars whose lengths differ by at most 1. Two regressions fixed here: unbounded bidirectional substring checks flagged allergens absent from the ingredients (e.g. "garlic" on a garlic-free product), and a distance-≤2 allowance for 6+ char tokens matched unrelated real words by coincidence (e.g. "garlic" vs "malic" as in malic acid, on Hot Tamales candy, barcode 070970474088). Don't loosen the distance threshold above 1 without a specific reason — it re-opens exactly that failure mode.
- **Scan result modal:** Orange banner `⚠️ Contains: garlic, onion` — non-blocking
- **Saved entries (barcode-scanned):** Orange border + persistent warning banner on entries with allergen matches, sourced from `barcode_data.warnings`

### Manual allergen flagging (photo/note entries with no barcode)

Barcode scans get automatic allergen matching against the ingredients text, but a photo or text-only entry has no ingredients list to match against — the user has to flag it themselves.

- **Trigger:** a dedicated `⚠️` icon button in the entry-actions row (`.entry-btn.warning`, between the star and edit/pencil icons) opens the "Flag Allergen" popover — not a whole-card tap, which was tried first and replaced because it made every other button on the card need `stopPropagation()`. The warning icon greys out (like the star) when nothing is flagged and lights up (`.warning-active`) when it is.
- **Data:** stored in `entries.allergen_warnings` (migration `0012_add_manual_allergen_warnings.sql`) as a JSON array of strings, independent of `barcode_data`. `'*'` (the `GENERIC_ALLERGEN_WARNING` constant) means "may contain an allergen" without naming one; picking any specific allergen clears `'*'` and vice versa (mutually exclusive, enforced in `toggleAllergenSelection`/`toggleGenericAllergenWarning`).
- **API:** `PATCH /api/entries` accepts `allergen_warnings` as a fourth optional field alongside `meal`/`created_at`/`text` — same dynamic-fields pattern, JSON-stringified before storing, `null` clears it.
- **Rendering:** a separate `.entry-allergen-warning` banner from the barcode one, driven by `parseAllergenWarnings(entry)`, checked independently of `entryBd?.warnings` for the `entry-warning` card-tint class.
- **User's allergen list** for the chip picker is loaded once via `loadUserAllergens()` (`+page.svelte`, calls `/api/allergens`) and refreshed whenever the Settings drawer's allergen list changes, via the `onAllergensChanged` callback passed into `SettingsPanel`.
- **Calendar indicator:** `entryHasAllergenWarning(entry)` (checks both `allergen_warnings` and `barcode_data.warnings`) feeds a `daysWithAllergenWarnings` Set, computed in `loadDaysWithEntries` alongside the existing entries/reactions sets. Rendered as an orange `.allergen-dot` alongside the existing green entry-dot / red reaction-dot in a `.day-dots` flex row — shown unconditionally (even on today/selected days, unlike the plain entry dot) since it's safety-relevant. `saveAllergenWarning()` must call `loadDaysWithEntries(calendarYear, calendarMonth)` after a successful PATCH, or the calendar won't pick up a newly flagged (or cleared) day until the next unrelated refresh.

## Stats & Settings Drawers

Stats and Settings used to be separate routes (`/stats`, `/profile`). They are now bottom sheets opened from the main page — there is no `src/routes/stats/` or `src/routes/profile/` anymore. Their content lives in `src/lib/StatsPanel.svelte` and `src/lib/SettingsPanel.svelte`, imported and rendered inside `.modal` sheets by `+page.svelte` (`showStats`/`showSettings` state).

- **StatsPanel** is fully self-contained — same as before, just without the page-level header/back-link (the drawer supplies its own header + close button).
- **SettingsPanel** needs two-way sync with the main page instead of a fresh page load, since it's now live in the same page instance:
  - `timezone` and `horizontalScroll` are `$bindable` props (`bind:timezone`, `bind:horizontalScroll` on `<SettingsPanel>` in `+page.svelte`) — changing them in the drawer updates the main page's own state immediately (meal-time calculations, carousel-vs-list rendering) without needing to close and reopen anything.
  - `highlightSection` is a plain prop (was a URL query param `?highlight=`) — the main page sets `settingsHighlight` before opening the drawer.
  - `onAllergensChanged` callback tells the main page to reload its own `userAllergens` copy (used by the Flag Allergen picker) whenever the drawer's allergen list changes.
  - `onSignOut` callback lets the main page control the post-logout redirect.
  - Theme changes are NOT synced via props — `applyTheme()` sets `document.documentElement`'s `data-theme` attribute directly, which is global and needs no cross-component wiring.
- **Deep link replacement:** the old `goto('/profile?highlight=passkey')` (used by `login/+page.svelte` after a passkey-less password signup) is now `goto('/?openSettings=passkey')`. The main page's `onMount` checks for `?openSettings=` in the URL, sets `settingsHighlight` and opens the Settings drawer, then strips the query param via `history.replaceState`.
- If you add a new Settings field that other parts of the main page also read (like timezone/horizontalScroll), make it a bindable prop rather than letting the drawer and main page keep separate copies that can drift apart.

## PWA Install Banner

- **`PwaInstallBanner.svelte`** in `+layout.svelte` — shows on every page
- **Android:** Listens for `beforeinstallprompt`, shows sticky bottom banner with Install button. Swipeable left/right to dismiss (touch tracking, dismisses at >100px offset)
- **iOS:** Shows one-time instruction card: "Tap Share ⬆️ then Add to Home Screen"
- **Dismissal:** Stored in `localStorage` key `pwa_install_dismissed`, hides for 7 days
- **Standalone check:** `window.matchMedia('(display-mode: standalone')` — never shows if already installed
- **`pwaInstall.ts`:** Extracts platform detection, dismissal logic, standalone check for testability

## Design System (src/app.css)

- **Never hardcode colors, radii, or shadows in component `<style>` blocks** — use the CSS custom properties defined in `src/app.css` (`--bg`, `--surface`, `--surface-elevated`, `--text-primary/secondary/tertiary`, `--primary`, `--danger`, `--warning`, `--accent`, `--radius-xs/sm/md/lg/xl/full`, `--shadow-xs/sm/md/lg/sheet`, `--spring`, `--ease-out`). If a new color/shape is needed, add a token to `:root` (and its dark-mode override) rather than hardcoding.
- **Dark mode:** overrides live under `[data-theme="dark"]` in `app.css`. The theme is applied via a `data-theme` attribute on `<html>`, toggled from the Settings drawer (Light/Dark/System), persisted in `localStorage`. Any new token must get both a light (`:root`) and dark (`[data-theme="dark"]`) value.
- **Native form controls (`<select>`, `<input>`) must set explicit `background` and `color`** — never rely on the browser's default control styling. `app.css`'s global `button, input, textarea, select { color: inherit; }` means a native control's text color follows the surrounding dark-mode text color, but its background stays the browser's UA default (often white) unless set explicitly — that combination is white-on-white in dark mode. `:root`/`[data-theme="dark"]` also set `color-scheme: light`/`color-scheme: dark` respectively as a baseline (fixes native dropdown/date-picker popups and scrollbars), but don't rely on that alone for the control's own box — pair it with explicit `background: var(--surface); color: var(--text-primary);` on the element itself, as `.edit-row select`/`.edit-row input`/`.allergen-input`/`.auth-input` do.
- **Bottom sheets, not centered dialogs:** modals use `sheet-in`/`sheet-out` keyframes (translateY) with the `--spring` easing curve, plus `overlay-in`/`overlay-out` for the backdrop. Dismissed via the overlay tap or an explicit close/cancel button — there is no drag handle. (A draggable `.sheet-handle` + `dragToDismiss` action was tried and removed: it never worked reliably on Android or macOS Chrome, fighting with native pull-to-refresh/scroll gestures, so don't re-add a swipe-to-dismiss handle without solving that first.)
- **Press feedback:** apply the `.btn-press` utility class (scale to 0.97 on `:active`) to tappable elements instead of writing bespoke `:active` rules.
- **Skeleton loading:** use `.skeleton` / `.skeleton-text` / `.skeleton-circle` / `.skeleton-img` instead of "Loading..." text — match the real DOM layout so content doesn't jump in.
- **Touch/PWA polish:** `-webkit-tap-highlight-color: transparent` and `overscroll-behavior-y: none` are set globally in `app.css` — don't re-add per-component.
- **Meal view toggle:** meal-section layout (vertical list vs. horizontal snap-scroll carousel) is a per-user preference stored in `localStorage`, toggled from Settings. Without an explicit saved preference, it defaults to carousel on mobile widths (`matchMedia('(max-width: 700px)')`) and list on desktop. The carousel only scrolls the entry cards — each meal's section header (Breakfast/Lunch/Dinner/Snacks) stays fixed above it.

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
- **Clean up branches after pushing.** After merging or pushing to `main`, delete any local feature branches. Run `git branch -d <branch>` and `git push origin --delete <branch>` for remote branches.
- **End-to-end tests required for all changes.** Every feature addition, bug fix, or behavior change MUST include corresponding tests in `src/lib/*.test.ts`. Tests should cover the happy path, edge cases, and the full flow (e.g., toggle on → toggle off, dedup behavior, empty input guard). If a test file doesn't exist for the module, create one.

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
