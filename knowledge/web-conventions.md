# Web Conventions

House law for product type `web-app` (and a library's browser target). The mobile packs
(`stack-defaults.md`, `ios-conventions.md`, `android-conventions.md`) do not apply to a browser
surface. A project's own `docs/22-impl-spec-web.md` and `docs/21-engineering-principles.md` win
over this pack where they say something different.

## Stack default

TypeScript `strict: true`; React with Next (App Router) unless the impl spec picks otherwise; npm
with the lockfile committed; Node LTS pinned in `.nvmrc` and `package.json` `engines`.

## `package.json` scripts — the runtime gate's contract

`runtime-gate.sh` builds and serves the app from these scripts and nothing else:

| Script | Must |
|---|---|
| `build` | produce the production build; exit non-zero on a type or lint error |
| `start` | serve that build and honour `$PORT` — or the build writes `index.html` to `dist/`, `build/` or `out/` |
| `test` | run the unit/component suite non-interactively (no watch mode) |
| `test:e2e` | drive the P0 journey in a real browser (Playwright by default) |
| `lint`, `typecheck` | exist and exit non-zero on a finding |

No `build`, or neither `start` nor a static `index.html` → the runtime gate is CANNOT EVALUATE.

## Build output is never tracked

`.gitignore` carries `node_modules/`, `dist/`, `build/`, `out/`, `.next/`, `coverage/`,
`playwright-report/`, `test-results/`. A tracked build output makes every gate run dirty the tree.

## Rendering and state

Server-render by default; a client component only where the ticket needs interactivity. State: URL,
then server state, then component state. A global store needs the impl spec's blessing.

## Hosting, headers, secrets

- Security headers live in committed hosting config: CSP `default-src 'self'` with no
  `unsafe-inline` script (nonce or hash), `frame-ancestors 'none'` unless embedding is a requirement,
  HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Anything in the client bundle is public. `NEXT_PUBLIC_*` / `VITE_*` values are never secrets.
- CORS is an explicit allow-list, never `*` on a credentialed endpoint.
- Preview deploys are `noindex` and never share production data or keys.

## Cookies and consent

Session cookies `HttpOnly; Secure; SameSite=Lax` (`Strict` where no cross-site entry exists).
Non-essential cookies and analytics fire only after consent (`analytics.md` §consent gate). The
cookie list is part of the privacy inventory.

## SEO and sharing baseline

Per route: a unique `<title>`, meta description, canonical URL and Open Graph tags; `<html lang>`;
`robots.txt` and `sitemap.xml` at the root.

## Accessibility

Semantic HTML before ARIA. Every interactive element keyboard-reachable with visible focus; every
image has alt text; every control a label; colour never the only signal; WCAG 2.2 AA contrast;
`prefers-reduced-motion` honoured.

## Performance budgets

Defaults until `docs/20-architecture.md` §8 states its own: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1
at p75 on mobile; initial JS ≤ 170 KB gzipped. Measured on the built app, never estimated.

## Analytics

Only when the ticket emits events: load `analytics.md` and the catalog in `docs/52-analytics.md`.

## Banned

`document.write`; `innerHTML` with user-supplied data; `dangerouslySetInnerHTML` without a sanitiser
named in the diff; `console.log` in a shipped path; an `any` that survives review; `@ts-ignore`
without a reason on the same line.
