# Food Tracker

A progressive web app for tracking everything you eat — photos, notes, organized by date — with allergy reaction logging, pattern detection, and passkey authentication.

**Live at:** https://foodtracker.mattm330xi.workers.dev

## Features

- **📷 Camera capture** — snap photos of your meals directly from your phone
- **📝 Notes** — add text notes to each entry (use your phone's built-in voice-to-text)
- **📅 Calendar view** — browse entries by date with a heatmap tint (shaded by entry count) plus green dots (entries) and red dots (reactions). Add entries to past or future dates with a confirmation prompt.
- **↔️ Swipe/arrow day navigation** — swipe left/right or tap the arrows next to the date heading to move between days
- **🍽️ Meal slots** — entries auto-assigned to Breakfast/Lunch/Dinner/Snacks based on your timezone
- **⚠️ Reaction logging** — log symptoms with severity (Mild/Moderate/Severe/Very Severe) and notes
- **📊 Stats page** — food-reaction correlations, entry/reaction counts, and a daily trend chart over selectable periods
- **⭐ Quick Add** — one sheet with tabs for Favorites, Meal Templates, and one-tap "repeat yesterday" entries
- **📷 Barcode scanner** — scan barcodes with your camera, look up products via Open Food Facts
- **⚠️ Allergen warnings** — set your allergens in Settings, get warnings when scanned products contain them
- **🔒 Authentication** — passkeys (Face ID / Touch ID) and/or passwords, your choice
- **⚙️ Settings** — manage timezone, allergens, passkeys, dark mode, meal view, sign out
- **📱 Installable PWA** — add to your home screen with guided install prompts
- **💾 Cloud storage** — all data stored in Cloudflare D1 (SQLite at the edge)
- **🌗 Dark mode** — light/dark/system theme toggle in Settings, backed by CSS custom properties
- **↔️ Carousel meal view** — meal sections default to a horizontal carousel on mobile and a vertical list on desktop, overridable in Settings

## Tech Stack

- **Frontend:** SvelteKit 2 + Svelte 5
- **Backend:** Cloudflare Worker
- **Database:** Cloudflare D1 (SQLite)
- **Hosting:** Cloudflare Workers
- **Auth:** Passkeys (WebAuthn) + optional password fallback
- **Images:** Base64 JPEG in D1 (compressed to 800px, ~0.6 quality)

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build
npm run build
```

### Deploy to Cloudflare

```bash
# Set your Cloudflare API credentials (export CF_API_TOKEN and CF_ACCOUNT_ID)
# CF API token set via environment variables

# Deploy
npm run cf:deploy
```

**IMPORTANT:** `npm run cf:deploy` runs `wrangler deploy` which does NOT auto-build. The build is included in the deploy script.

### Test

```bash
# Run all tests (barcode scanner, timezone, entries, date range, favorites, PWA install, auth)
npm test

# Typecheck (must be 0 errors before deploying)
npm run check
```

Test files:
- `src/lib/barcodeScanner.test.ts` — scanner teardown lifecycle, stale-detection race (9 tests)
- `src/lib/timezone.test.ts` — UTC/local conversion, no double-offset (6 tests)
- `src/lib/entries.test.ts` — entries PATCH logic (meal/created_at/text, any combination), date filtering (8 tests)
- `src/lib/dateRange.test.ts` — date range bounds for index-friendly queries (5 tests)
- `src/lib/favorites.test.ts` — favorites CRUD, toggle flow, client-side isFavorited logic (16 tests)
- `src/lib/pwaInstall.test.ts` — PWA install banner, platform detection, dismissal (14 tests)
- `src/lib/auth.test.ts` — password hashing, registration/login flows, cross-method confirmation, needsPasskey, multi-device sessions (34 tests)
- `src/lib/allergenMatch.test.ts` — allergen fuzzy-matching: exact/compound/misspelling cases, false-positive regressions (22 tests)

### Database

The D1 database `foodtrackerd1` is managed via migrations in `migrations/`. Key tables:

- `entries` — food entries with photo, text, meal slot, day notes, barcode_data (JSON)
- `reactions` — allergy/symptom reactions with severity
- `favorites` — saved frequently-used foods
- `meal_templates` — saved day templates
- `users` — user accounts with timezone
- `sessions` — session tokens (60-day rolling expiry)
- `credentials` — WebAuthn passkey credentials (public keys, counters)
- `user_allergens` — per-user allergen ingredients (comma-separated input supported)

### Timezone Support

All dates/times are stored as ISO 8601 UTC strings. The frontend converts to the user's configured timezone (default: `America/New_York`) for display. Meal auto-assignment uses the user's timezone.

### Authentication

Passkeys (WebAuthn) and passwords. The flow:

1. **Passkey login:** `login-start` → browser Face ID/Touch ID → `login-finish` → session cookie
2. **Password login:** `login-password` → PBKDF2-SHA256 verify → session cookie
3. **Session:** HttpOnly cookie `ft_session` with 60-day rolling expiry, refreshed on every authenticated request. Multiple devices/browsers can be signed in at once — signing in on one doesn't sign out the others.
4. **Validation:** `hooks.server.ts` validates session on every request (except login, barcode, static assets)
5. **Cross-method confirmation:** If you try the wrong auth method, the server prompts you to confirm with your existing method before setting the new one
6. **Sign out:** clears cookie and deletes session from DB

## Project Structure

```
src/
├── app.html                    # HTML shell with viewport meta
├── app.css                     # Global design tokens, reset, dark mode, skeleton/sheet utilities
├── app.d.ts                    # TypeScript types (App.Locals, Platform)
├── hooks.server.ts             # Session validation middleware
├── routes/
│   ├── +layout.svelte          # Service worker registration + PWA install banner
│   ├── +page.svelte            # Main UI (entries, reactions, calendar heatmap, Quick Add sheet, barcode scanner with allergen warnings)
│   ├── login/+page.svelte      # Passkey + password login/register
│   ├── profile/+page.svelte    # Timezone, allergens, sign-in methods, sign out
│   ├── stats/+page.svelte      # Food-reaction correlation stats
│   └── api/
│       ├── auth/+server.ts     # Passkey + password auth API (login, register, logout)
│       ├── entries/+server.ts  # CRUD for food entries
│       ├── reactions/+server.ts # CRUD for reactions
│       ├── day-notes/+server.ts # Day-level notes
│       ├── favorites/+server.ts # CRUD for favorites
│       ├── templates/+server.ts # CRUD for meal templates
│       ├── stats/+server.ts    # Food-reaction correlation stats
│       ├── profile/+server.ts  # Timezone, sign-in methods, passkey management
│       ├── barcode/+server.ts  # Open Food Facts lookup + allergen check
│       ├── allergens/+server.ts # CRUD for user allergens
├── static/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker (v5, no API caching)
│   ├── icon.svg                    # App icon (food-themed SVG)
│   ├── icon-192.png                # PWA icon 192px
│   └── icon-512.png                # PWA icon 512px
├── src/lib/
│   ├── timezone.ts                 # UTC/local conversion utility
│   ├── timezone.test.ts            # Timezone tests
│   ├── entries.test.ts             # Entries API logic tests
│   ├── barcodeScanner.test.ts      # Scanner teardown tests
│   ├── dateRange.test.ts           # Date range helper tests
│   ├── auth.test.ts                # Auth (password hashing, registration, login, cross-method confirmation) tests
│   ├── favorites.test.ts           # Favorites CRUD, toggle flow, client-side isFavorited logic tests
│   ├── pwaInstall.test.ts          # PWA install banner, platform detection, dismissal tests
│   ├── BarcodeScanner.svelte       # Native BarcodeDetector barcode scanner (UPC-A/EAN-13, rAF scan loop, clean teardown)
│   ├── PwaInstallBanner.svelte     # Swipeable install banner (Android) + iOS instructions
│   └── pwaInstall.ts               # Platform detection, dismissal logic
├── migrations/
│   ├── 0001_initial_schema.sql     # entries table
│   ├── 0002_add_meal_column.sql    # meal field + auto-assignment
│   ├── 0003_create_reactions.sql   # reactions table
│   ├── 0004_add_day_notes.sql      # day_notes field
│   ├── 0005_favorites_and_templates.sql # favorites + meal_templates
│   ├── 0006_add_users_and_user_id.sql   # users table + user_id foreign keys
│   ├── 0007_webauthn.sql           # credentials table (WebAuthn)
│   ├── 0008_add_barcode_data.sql   # barcode_data JSON column on entries
│   ├── 0009_add_user_allergens.sql  # user_allergens table
│   ├── 0010_performance_indexes.sql # session, credential, favorite, template indexes
│   └── 0011_add_password_hash.sql   # password_hash column for password auth
├── vitest.config.ts                # Vitest config (svelte + jsdom)
└── wrangler.toml                   # Cloudflare Worker config with D1 binding
```

## Key Technical Decisions

- **SvelteKit over Next.js:** Next.js is deprecated on Cloudflare Pages
- **Worker deployment over Pages:** wrangler.toml uses `main` + `[assets]`
- **Base64 in D1 over R2:** images compressed to 800px JPEG ~0.6 quality
- **Passkeys + password fallback:** passkeys as primary auth (Touch ID / Face ID), optional password for browsers without WebAuthn support. Cross-method confirmation flow for adding a second auth method.
- **Manual CBOR parsing + `crypto.subtle`:** avoids Node.js dependencies that don't work on Workers
- **All timestamps as ISO 8601 UTC:** `new Date().toISOString()` in JS, not SQLite's `datetime('now')`
- **Session cookie:** `HttpOnly; Secure; SameSite=Lax; Path=/` with 60-day Max-Age, refreshed on every authenticated request (rolling window) — not just at login
- **Multiple devices:** signing in on a new device/browser does not sign out other devices; each has its own session row, and signing out only ends that one device's session
- **Native BarcodeDetector API for barcode scanning:** zero-dependency scanner using browser-native `BarcodeDetector` with explicit UPC-A/EAN-13 formats, `requestAnimationFrame` scan loop, synchronous teardown via `cancelAnimationFrame` + `track.stop()`. Includes manual barcode text input fallback.
- **No voice button:** phone keyboards have built-in voice-to-text
- **`npm run build` required before deploy:** `wrangler deploy` does not auto-build

## Design System

- **Tokens:** `src/app.css` defines all colors, radii, shadows, and easing curves as CSS custom properties (`--bg`, `--surface`, `--primary`, `--radius-md`, `--shadow-sm`, `--spring`, etc). No component should hardcode a hex color — reference a token instead.
- **Dark mode:** `[data-theme="dark"]` overrides the token values. Toggled from the Settings page (Light/Dark/System), stored in `localStorage` and applied via a `data-theme` attribute on `<html>`.
- **Bottom sheets:** Modals slide up from the bottom using the `sheet-in`/`sheet-out` keyframes with a spring easing curve (`--spring`), rather than centered dialogs. Each has a draggable handle at the top — swipe it down past 80px to dismiss, or release early to snap back.
- **Press feedback:** `.btn-press` utility class scales interactive elements to `0.97` on `:active` for native-feeling touch feedback.
- **Skeleton loading:** `.skeleton` / `.skeleton-text` / `.skeleton-circle` utilities replace "Loading..." text with placeholders matching the real layout.
- **Meal view toggle:** Meal sections default to a horizontal snap-scroll carousel on mobile widths and a vertical list on desktop; either can be overridden from Settings, persisted in `localStorage`. Each meal's section header stays fixed while its entries scroll horizontally.

## Deployment Notes

- CF API token set via environment variables
- All D1 `.bind()` params must never be `undefined` — use `?? null` or `?? 0`
- Every route handler must have top-level try/catch returning detailed error JSON
- Public key storage: COSE key extracted from attestationObject, stored as base64url string in D1
- `toAB()` handles all D1 BLOB return types: ArrayBuffer, Uint8Array, hex strings, base64 strings, arrays
