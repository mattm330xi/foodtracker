# Agents

## Deploy

This is a **Cloudflare Workers** project (not Pages).

Before deploying, source the environment variables:

```
source ~/mattm330xicfVars
```

Then deploy:

```
npm run cf:deploy
```

This runs `wrangler deploy` (Workers deploy, NOT `wrangler pages deploy`).

## Build

```
npm run build
```

## Typecheck

```
npm run check
```
