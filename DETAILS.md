# Mini Game Portal - details

> Short overview: [README.md](README.md). This file holds the project internals.

A tiny portal (screenshot + links) in front of a collection of browser mini games.
Games are built with **three.js** unless stated otherwise, bundled with **Rsbuild**.

| Game                                      | Play            | Tools                                                                                             |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| [Gravel Rally](src/games/rally/README.md) | `/games/rally/` | `/games/rally/map-viewer.html` · `/games/rally/car-viewer.html` · `/games/rally/asset-debug.html` |
| [Hole Island](src/games/hole/README.md)   | `/games/hole/`  | `/games/hole/item-viewer.html` · `/games/hole/map-viewer.html` · `/games/hole/balance.html`       |

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm run dev:noreload  # same, no HMR / live reload (debugging, benchmarks, stage-card bakes)
npm run test       # unit + data tests (fast); `npm run test:integration` = playtests (slow), see `integration-tests/README.md`
npm run lint
npm run build      # dist/
```

## Layout

```
src/
  site.config.ts       allowed hosts (domain lock), owner, portal tagline
  portal/              the landing page (lists every game automatically)
    manifest.ts        game.json schema, shared with rsbuild.config.ts
  shared/              cross-game helpers (no game logic)
    debug-panel.ts     left-side tool menu (lists, sliders, toggles, seeds)
    url-state.ts       typed query-string state for bookmarkable tool views
    portal-link.ts     "All games" URL when a game runs inside the portal (games/<id>/)
    stats-overlay.ts   FPS / draw calls / triangles (F3)
    thumbnail.ts       dev-only "F9 = save portal screenshot"
    consent.ts         cookie banner + Google Analytics loader (every page)
    rng.ts, noise.ts   seeded random + simplex noise
  games/<id>/          one folder per game, self-contained
    game.json          title, description, pages -> picked up by build + portal
    thumbnail.jpg      portal screenshot (press F9 in the game during `npm run dev`)
tests/                 rstest tests (per game sub-folder)
.claude/skills/        workflows for agents: new game, maps, content, physics tuning
```

## Domain lock

Pages only run on the hosts listed in `src/site.config.ts` (`allowedHosts`, default `deni.io`, `*.deni.io` and
localhost on any port). The check (`src/shared/host-guard.ts`) is injected before every page by Rsbuild
`source.preEntry`. It's a deterrent against casual re-hosting, not DRM.

`npm run dev -- --host` also lets phones / tablets on the same network open the dev server: the guard accepts private
addresses (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, `*.local`, see `isDevLanHost`) **only in the dev server**, never in
production builds.

## Analytics + cookie banner

Google Analytics 4 (`SITE.gaMeasurementId` in `src/site.config.ts`, value from `PUBLIC_GA_MEASUREMENT_ID` in the untracked `.env.local` - copy the tracked template `.env.example`) loads **only after the visitor clicks Accept** on the
cookie banner (`src/shared/consent.ts`, injected before every page by `source.preEntry` via `consent-boot.ts`). Decline =
no gtag.js and no `_ga` cookies; the games work the same either way (a "decline closes the site" cookie wall would make
the consent invalid under GDPR). The choice is kept in localStorage (`mgp.consent.v1`) for 12 months. "Privacy & cookies"
in the portal footer reopens the banner; switching to Decline deletes existing `_ga` cookies. The banner's "Privacy
details" is the privacy notice - set `SITE.privacyContact` to show a contact e-mail there.

GA only loads in production builds on a non-local host, so `npm run dev` / `npm run preview` never send hits (the banner
still shows, for testing). Empty / unset `PUBLIC_GA_MEASUREMENT_ID` (a fresh clone, or any fork) removes both the banner and analytics.

**Game events** (`track(game, event, params)` in `src/shared/analytics.ts`; sent only when gtag.js is loaded, so never
without consent or in dev). Event names are `game_<game id>_<event>` (e.g. `game_rally_level_end`), `<event>` = GA4's
recommended game events. Param names are `game_<name>` when every game sends them and `game_<game id>_<name>` when only one
does; `game_id` is added to every event. `?analytics=log` prints each event to the console, also in dev.

| `<event>`        | Sent when                                                                                   | Params                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level_start`    | rally: stage clock starts (GO); hole: run starts (countdown)                                | `game_id`, `game_level_name` (map id), `game_version`; rally `_car`, `_tyre`, `_setup`, `_gearing`, `_times_version`; hole `_difficulty`, `_seed`, `_layout`, `_scoring_version` |
| `level_end`      | run finished (`game_success: true`) or left mid-run (`game_success: false` + `game_reason`) | start params + `game_time_s`; rally `_penalty_s`, `_new_best` (quit: `_progress_pct`); hole `game_score`, `_level`, `_cleared`, `_items_eaten`, `_pct_eaten`                     |
| `post_score`     | run finished                                                                                | start params + `game_score` (rally: stage time in ms, lower is better; hole: points), `game_character` (car / hole colour); hole `_level`                                        |
| `select_content` | a viewer page opens (car viewer: also on car change)                                        | `game_content_type` (`map_viewer`, `car_viewer`), `game_content_id` (map / car id)                                                                                               |

`_x` = `game_rally_x` / `game_hole_x`.

- Only ranked runs are tracked: no rally free drive / test pad, no Hole dev runs (`?time=`, `?level=`, `?bot=1`).
- Quits are tracked from the pause menu (restart, main menu, portal, rally spawn change); closing the tab is not.
- `game_rally_times_version` / `game_hole_scoring_version` keep times / scores from before a physics or scoring change apart in reports.
- GA property settings (Admin; not in code, redo them for a new property):
  - every param above registered as an event-scoped custom dimension (`game_time_s`, `game_score`, `game_hole_level`,
    `game_hole_items_eaten`, `game_hole_pct_eaten`, `game_rally_penalty_s`, `game_rally_progress_pct` as custom metrics);
    unregistered params only show in Realtime / DebugView, and registration is not retroactive.
  - Enhanced measurement: "Page changes based on browser history events" **off** (viewers rewrite the URL on every camera
    move); Form interactions and Site search off.
  - Data retention 14 months; Google signals and ads personalization off (the banner promises no ads); internal traffic
    filter active for the owner's IP.

**Banner setting:** `SITE.showPrivacyBanner` in `src/site.config.ts`. `'production'` (current) = banner + footer link only in
the production build, hidden on `npm run dev`; `true` = also in dev (to test the banner); `false` = hidden everywhere.
Wherever the banner is hidden, GA does not load either (it only ever runs after Accept, as GDPR / ePrivacy require).

## Install as an app (PWA)

Every page links `public/manifest.webmanifest` (standalone display, relative `start_url` / `scope`, so it works from any
sub-folder; game pages link the portal's copy two folders up, so the installed app is always the whole portal) and an
`apple-touch-icon` (`public/icons/`, built from `public/favicon.png` on the portal background colour; each game folder
gets its own copy).
The links + home-screen meta tags are added to every page in `rsbuild.config.ts` (`html.meta` / `html.tags`).
On iPad: open the site in Safari -> Share -> **Add to Home Screen**.
Standalone mode has no back button, so each game's main menu, pause and results screens show **All games** when the
page runs inside the portal (`games/<id>/`, detected by `src/shared/portal-link.ts`); a game hosted on its own hides it.
Home-screen app name = `apple-mobile-web-app-title` ("Mini Games"). Replace the icons in `public/icons/` to change the artwork.

## Offline play

`public/sw.js` (copied to the portal root, registered by `src/shared/offline.ts` from every page, production build only):
pages are network-first, everything else stale-while-revalidate, same-origin GET only. Nothing is precached: a game works
offline after one online visit (its car GLBs are cached when first requested; ~7 MB). Relative URLs, so it works under a
sub-folder such as `/mini-games/`. Changing the caching rules: bump `CACHE` in `sw.js`.

## Portal footer

The portal page shows `SITE.tagline` ("This site was made using AI agents under direction of ...") with
`SITE.owner` and "Copyright <current year>" - both in `src/site.config.ts`.

## Adding a game

1. Create `src/games/<id>/game.json` (copy `src/games/rally/game.json`) and the entry files it lists.
2. `npm run dev` — pages are discovered automatically: `play` -> `/games/<id>/`, others -> `/games/<id>/<page>.html`.
3. Press **F9** in-game (dev server only) to save `thumbnail.jpg` for the portal card (call `installThumbnailCapture` once in your play page).

See `.claude/skills/new-minigame/SKILL.md` for the full checklist.

## Deploying

`npm run build` writes `dist/`, which can be uploaded to the domain root or any sub-folder (e.g. `https://example.com/games/`): asset URLs are relative (`output.assetPrefix: 'auto'`, in dev too), and so are all in-app links. Keep it that way - never start an href with `/`. From a game page the portal is `../../`; sibling pages of the same game are just `<page>.html` / `./`.

**Every game is self-contained.** `rsbuild.config.ts` creates one Rsbuild _environment_ per game (named after its id) plus
`portal`, each with its own output folder and nothing shared between them (each game ships its own three.js chunk):

```
dist/
  index.html, static/, favicon.png, icons/, manifest.webmanifest   <- portal (game cards + thumbnails)
  games/rally/   *.html, static/, favicon.png, icons/, models/      <- everything Gravel Rally loads
  games/hole/    *.html, static/, favicon.png, icons/               <- everything Hole Island loads
```

So a game can be rebuilt and uploaded on its own while other games are unfinished:

```bash
npm run build -- --environment rally     # rewrites only dist/games/rally/ -> upload that folder
npm run build -- --environment portal    # only the portal files in dist/ (keeps dist/games/)
```

### GitHub Pages test builds

`.github/workflows/pages.yml` (**Actions > Deploy to GitHub Pages > Run workflow**, pick any branch) builds that branch and
publishes `dist/` to `https://<owner>.github.io/<repo>/`. One-time: Settings > Pages > Source = **GitHub Actions**. Each run
replaces the previous deploy, so the site shows whichever branch ran last. The domain lock does not list the `github.io`
host, so the pages show the "only available at" notice until that host is added to `allowedHosts`.

Upload the game folder as a whole (replace the old one): file names are content-hashed, so stale files can be deleted.
The portal lists every game folder in `src/games/`, so rebuild / upload the portal only when its game list should change.
Game-only files from the root `public/` are copied into that game's folder only (`gamePublicFiles` in the config, e.g.
`public/models/` -> `dist/games/rally/models/`); the root `public/` is not copied as a whole. The only links from a game to
the portal are the **All games** button and the PWA manifest (`../../manifest.webmanifest`), both of which the portal
always provides.
