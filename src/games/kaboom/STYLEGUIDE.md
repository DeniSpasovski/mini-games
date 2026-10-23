# 3, 2, 1 Kabooom UI style guide

The look of the menus, the HUD and the pause / results screens ("Claymation"): everything is a lump of clay, a cream slab with a
thumbprint, an ink outline and a wobble, and chunky buttons that squash when pressed. All values live in
[`game/ui-tokens.css`](game/ui-tokens.css); `kaboom.css` uses `var(--kb-*)` only, so a change of look starts there.

| Welcome                                | New match                              | The count                          |
| -------------------------------------- | -------------------------------------- | ---------------------------------- |
| ![Welcome](screenshots/ui-welcome.jpg) | ![Setup](screenshots/ui-setup.jpg)     | ![Count](screenshots/ui-count.jpg) |
| **Paused**                             | **Results**                            |                                    |
| ![Pause](screenshots/ui-pause.jpg)     | ![Results](screenshots/ui-results.jpg) |                                    |

## Principles

- **The arena is the hero.** Cards are small, sit on the left of a wide screen (a bottom sheet on a narrow portrait one) and the
  live bot match stays visible behind every menu. The HUD hides while a card is up.
- **One shape for every button.** A lump of clay with a gloss, an ink outline and an ink edge underneath; the edge is the shadow
  and the press squashes it. The primary action is the same shape in yellow.
- **Wobble the slabs, never the controls.** Cards and the logo "boil" (a few frames of displacement, like stop-motion). Buttons,
  text fields and anything you aim at stay still.
- **A plate under every HUD item.** Chips, pills and the count are clay on an ink ring, so they read on sand, grass and sea; no
  bare text over the world.
- **Colour means a team or an action.** Team colours (the eight in `characters.ts`) mean players, yellow means "do this", ink
  means text and outlines. The five clay colours are for the logo and nothing else.
- **A match ends on a stage.** The camera pulls back, a clay podium rises, the crew climbs it and the crowd holds up cards; the
  results card opens a moment later.

## Colour

|                                                                                                                                                                      | Token                 | Value                                             | Use                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| ![ink](styleguide/ink.svg)                                                                                                                                           | `--kb-ink`            | `#3b2418`                                         | text, outlines, the edge under cards and buttons              |
| ![ink-2](styleguide/ink-2.svg)                                                                                                                                       | `--kb-ink-2`          | `#6e5240`                                         | secondary text (5.6:1 on the card)                            |
| ![card](styleguide/card.svg)                                                                                                                                         | `--kb-card`           | `#f3e2c4`                                         | cards, HUD chips (ink on it 11.4:1)                           |
| ![edge](styleguide/card-edge.svg)                                                                                                                                    | `--kb-card-edge`      | `#d9c29c`                                         | the lower edge of a card                                      |
| ![btn](styleguide/btn.svg)                                                                                                                                           | `--kb-btn` / `-off`   | `#f8ecd6` / `#e2cfac`                             | buttons, rows; disabled                                       |
| ![accent](styleguide/accent.svg)                                                                                                                                     | `--kb-accent`         | `#f6c23e`                                         | primary button, selected choice, focus ring (ink on it 8.8:1) |
| ![you](styleguide/you.svg)                                                                                                                                           | `--kb-you`            | `#ffe1b5`                                         | your row in the results                                       |
| ![win](styleguide/win.svg)                                                                                                                                           | `--kb-win`            | `#17663a`                                         | "You win" headline (5.5:1 on the card)                        |
| ![lose](styleguide/lose.svg)                                                                                                                                         | `--kb-lose`           | `#b42318`                                         | headline when a bot wins (5.2:1)                              |
| ![tnt](styleguide/tnt.svg)                                                                                                                                           | `--kb-tnt`            | `#d8362f`                                         | the TNT button and the dynamite icon                          |
| ![clay-1](styleguide/clay-1.svg) ![clay-2](styleguide/clay-2.svg) ![clay-3](styleguide/clay-3.svg) ![clay-4](styleguide/clay-4.svg) ![clay-5](styleguide/clay-5.svg) | `--kb-clay-1` .. `-5` | `#e8553d` `#f6c23e` `#4b8fe0` `#6cc070` `#9a66d2` | logo balls and letters, always ink-outlined                   |
| ![page](styleguide/page.svg)                                                                                                                                         | `--kb-page`           | `#bfdcea`                                         | the page behind the game before the first frame               |

The banners over the arena (`--kb-banner-*`) and the sudden-death timer (`--kb-sudden`, `-2`) have their own tokens.
Check a new text colour against the card (4.5:1) and a new fill against its text before adding it.

## Type

- **Display:** Grandstander 800 for the logo, headings, the primary button, the rank numbers and the banners.
- **Body:** Nunito 700 / 800 for body text, buttons, labels and tables.
- **Numbers:** timers and tables use tabular numerals so digits do not jitter.
- Fonts are self-hosted (latin + latin-ext woff2, [`assets/fonts/`](assets/fonts/), SIL Open Font License, see
  [`THIRD-PARTY.md`](../../../THIRD-PARTY.md)). Nothing depends on an OS font; the fallbacks only cover loading.
- Sizes: logo 40-56 px, headings 24-30 px, primary button 22-26 px, buttons 17 px, labels 13-15 px. Nothing below 12 px.

## Shape and components

- **Card** (`.kb-card`): cream slab, 4 px ink outline, 24 px radius, an edge underneath and a soft drop shadow, with a thumbprint
  texture. The slab is a `::before`, so its wobble (`filter: url(#kb-boil)`, an SVG turbulence whose seed steps 1 to 4 every
  125 ms while a card is up) never touches the text. The boil is still under `prefers-reduced-motion` and on low quality.
  A card taller than the screen scrolls inside the menu layer and its action row (`.kb-actions`) stays in view.
- **Logo** (`.kb-logo`): the 3, 2, 1 balls in red, blue and green, and "Kabooom" in clay letters with ink outlines.
- **Button** (`.kb-btn`): 14 px radius, 48 px tall (primary 58 px), 3 px ink outline, `--kb-lip` sets the edge: hover lifts it,
  `:active` squashes it. Round variant for the arrows, stepper and pause. Focus is a yellow ring on an ink ring.
- **Segmented choice** (`.kb-seg` / `.kb-segbtn`): the same shape; the chosen one is yellow and pressed in
  (`aria-pressed`). Arena, level, skill and rounds use it. "Match rules ›" expands the level, skill and rounds inline.
- **Colour swatch** (`.kb-swatch`): a team-colour ball; the chosen one is pressed in with a cream and ink ring.
- **Critter stage** (`.kb-stage`): the live critter turning on a team-coloured disc; a still portrait without WebGL.
- **Icons** ([`game/icons.ts`](game/icons.ts)): the star, the dynamite stick and the pause bars, inline SVG with their colours
  from `ICON_COLORS` (the same values as the tokens); never emoji or text glyphs.

## HUD

- Top left: a chip per player, a portrait on a ring in the team colour; yours is a little bigger, a player who is out squashes
  flat and turns grey (and says "out" in its title). Round wins are stars on an ink pill under the chip.
- Top centre: the timer pill, and "Round 2 / 3" under it. It blinks in sudden death. Top right: the pause button.
- Bottom left: dynamite stock and blast level as icons. Touch: a floating stick and the TNT button.
- The 3 / 2 / 1 count is the logo's clay balls (red, blue, green) dropping in, then "GO!". Hints and subtitles are cream pills.
- Round banners ("You win the round!") are big italic letters on an ink outline in the banner colours.

## Overlays and results

- **Pause** is a card over the paused arena (no HUD) with Resume first. **Results** is a card with the headline, a row per
  player (rank, portrait on a team ring, name, stars, blasts), then Play again, Change setup and Main menu.
- **The finale** (`WorldView.finale`): the camera pulls back to the whole stand, the arena floor clears, a clay podium
  (`render/podium.ts`, 2 - 1 - 3, the place pressed into the front) rises and the crew climbs it, the winner hopping. The far
  stand holds up a board of cards that spells "YOU!" or the winner's name in their team colour (`render/card-stunt.ts`; a tie
  lights the board in two colours). The results card docks left on a wide screen and opens 1.2 s after the match ends. A round
  win sends a short wave of coloured cards across the stand.

## Layout rules

- Small screens: the action buttons and the version label stay visible; the mobile game is landscape only (check 915x412).
  On a narrow portrait window the setup and results cards become a bottom sheet with the arena above it.
- Setup fits 1280x720 without scrolling: the critter and colours on the left, the match on the right.
- The same UI in two places shares code (back button, results rows).
- Motion: the boil, the dropping count and the pop of a banner are the only animation; under `prefers-reduced-motion` the boil
  stops and banners only fade.

## Adding UI

1. Take colours, fonts and radii from `ui-tokens.css`; add a token before adding a literal colour in `kaboom.css`.
2. Check contrast of new text colours against the card (4.5:1).
3. Never put the boil on a control or on text. Use `.kb-btn` for anything you press.
4. Check 1280x720 and 915x412 screenshots, and keyboard, pad and touch focus.
5. Update this file when a token or a component changes (a colour token: also its swatch in [`styleguide/`](styleguide/));
   retake the screenshots above when a screen's look changes (`screenshots/ui-*.jpg`, 1280x720, taken in game with `?mute=1`).
