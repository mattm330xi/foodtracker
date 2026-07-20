# Food Tracker

A progressive web app for tracking everything you eat — photos, notes, organized by date — with allergy reaction logging, pattern detection, and passkey authentication.

**Live at:** https://foodtracker.mattm330xi.workers.dev

## Features

- **📷 Camera capture** — snap photos of your meals directly from your phone
- **📝 Notes** — add text notes to each entry (use your phone's built-in voice-to-text)
- **📅 Calendar view** — browse entries by date with green dots (entries) and red dots (reactions)
- **🍽️ Meal slots** — entries auto-assigned to Breakfast/Lunch/Dinner/Snacks based on your timezone
- **⚠️ Reaction logging** — log symptoms with severity (Mild/Moderate/Severe/Very Severe) and notes
- **📊 Stats page** — food-reaction correlations, entry/reaction counts over selectable periods
- **⭐ Favorites** — star entries to save them for quick re-add
- **📋 Meal templates** — save a day as a template and re-use it
- **📊 Barcode scanner** — look up products via Open Food Facts
- **🔒 Passkey authentication** — WebAuthn passkeys (Touch ID / Face ID), no passwords
- **👤 Profile** — manage timezone, add/remove passkeys, sign out
- **📱 Installable PWA** — add to your home screen
- **💾 Cloud storage** — all data stored in Cloudflare D1 (SQLite at the edge)

## Tech Stack

- **Frontend:** SvelteKit 2 + Svelte 5
- **Backend:** Cloudflare Worker
- **Database:** Cloudflare D1 (SQLite)
- **Hosting:** Cloudflare Workers
- **Auth:** WebAuthn passkeys (no passwords)
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
source ~/your_cf_env_vars

# Deploy (build MUST run first — wrangler deploy does NOT auto-build)
npm run build && npx wrangler deploy
```

**IMPORTANT:** `wrangler deploy` does NOT rebuild. Always run `npm run build` before deploying.

### Database

The D1 database `foodtrackerd1` is managed via migrations in `migrations/`. Key tables:

- `entries` — food entries with photo, text, meal slot, day notes
- `reactions` — allergy/symptom reactions with severity
- `favorites` — saved frequently-used foods
- `meal_templates` — saved day templates
- `users` — user accounts with timezone
- `sessions` — session tokens (60-day rolling expiry)
- `credentials` — WebAuthn passkey credentials (public keys, counters)

### Timezone Support

All dates/times are stored as ISO 8601 UTC strings. The frontend converts to the user's configured timezone (default: `America/New_York`) for display. Meal auto-assignment uses the user's timezone.

### Authentication

Passkey-only (WebAuthn). No passwords, no PINs. The flow:

1. **Login:** `login-start` → browser Touch ID → `login-finish` → session cookie
2. **Session:** HttpOnly cookie `ft_session` with 60-day rolling expiry, refreshed on each login
3. **Validation:** `hooks.server.ts` validates session on every request (except login, barcode, static assets)
4. **Sign out:** clears cookie and deletes session from DB

## Project Structure

```
src/
├── app.html                    # HTML shell with viewport meta
├── app.d.ts                    # TypeScript types (App.Locals, Platform)
├── hooks.server.ts             # Session validation middleware
├── routes/
│   ├── +layout.svelte          # Service worker registration
│   ├── +page.svelte            # Main UI (entries, reactions, calendar, favorites, templates, barcode)
│   ├── login/+page.svelte      # Passkey login/register
│   ├── profile/+page.svelte    # Timezone, passkey management, sign out
│   ├── stats/+page.svelte      # Food-reaction correlation stats
│   ├── passkey-setup/+page.svelte  # Temporary one-time passkey setup
│   └── api/
│       ├── auth/+server.ts     # WebAuthn API (login, register, logout)
│       ├── entries/+server.ts  # CRUD for food entries
│       ├── reactions/+server.ts # CRUD for reactions
│       ├── day-notes/+server.ts # Day-level notes
│       ├── favorites/+server.ts # CRUD for favorites
│       ├── templates/+server.ts # CRUD for meal templates
│       ├── stats/+server.ts    # Food-reaction correlation stats
│       ├── profile/+server.ts  # Timezone, passkey management
│       ├── barcode/+server.ts  # Open Food Facts lookup
│       └── passkey-setup/+server.ts # Temporary passkey setup endpoint
static/
├── manifest.json               # PWA manifest
├── sw.js                       # Service worker (v3, no API caching)
├── icon.svg                    # App icon (food-themed SVG)
├── icon-192.png                # PWA icon 192px
└── icon-512.png                # PWA icon 512px
migrations/
├── 0001_initial_schema.sql     # entries table
├── 0002_add_meal_column.sql    # meal field + auto-assignment
├── 0003_create_reactions.sql   # reactions table
├── 0004_add_day_notes.sql      # day_notes field
├── 0005_favorites_and_templates.sql # favorites + meal_templates
├── 0006_add_users_and_user_id.sql   # users table + user_id foreign keys
└── 0007_webauthn.sql           # credentials table (WebAuthn)
wrangler.toml                   # Cloudflare Worker config with D1 binding
```

## Key Technical Decisions

- **SvelteKit over Next.js:** Next.js is deprecated on Cloudflare Pages
- **Worker deployment over Pages:** wrangler.toml uses `main` + `[assets]`
- **Base64 in D1 over R2:** images compressed to 800px JPEG ~0.6 quality
- **WebAuthn (passkeys) over passwords:** user explicitly requested passkey-only auth
- **Manual CBOR parsing + `crypto.subtle`:** avoids Node.js dependencies that don't work on Workers
- **All timestamps as ISO 8601 UTC:** `new Date().toISOString()` in JS, not SQLite's `datetime('now')`
- **Session cookie:** `HttpOnly; SameSite=Lax; Path=/` with 60-day Max-Age, rolling refresh on login
- **No voice button:** phone keyboards have built-in voice-to-text
- **`npm run build` required before deploy:** `wrangler deploy` does not auto-build

## Deployment Notes

- CF API token set via `source ~/mattm330xicfVars` (home dir, never committed)
- All D1 `.bind()` params must never be `undefined` — use `?? null` or `?? 0`
- Every route handler must have top-level try/catch returning detailed error JSON
- Public key storage: COSE key extracted from attestationObject, stored as base64url string in D1
- `toAB()` handles all D1 BLOB return types: ArrayBuffer, Uint8Array, hex strings, base64 strings, arrays
