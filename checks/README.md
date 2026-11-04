# Browser checks

Serve this checkout on loopback port 4187 with `python3 tools/edit.py --port 4187 --no-open --no-backups`
(the editor's server; `admin.js` needs it to save, and the other checks run on it unchanged).
`index-keyboard.js` is an async function accepting a Playwright `page`. Run it in an existing
Playwright environment, or pass its contents to the Playwright browser tool's code runner.
It returns `ok` and 40 per-case results covering 1280/390 widths and normal/reduced motion.

Use a fresh browser context, or reload the page and revalidate cached assets when switching
checkouts behind the same URL. Keep the task tab focused for genuine keyboard input. The function
uses real Enter, Escape, I, Tab and Shift+Tab events; DOM state is read only for assertions.
The original 48263c8 preview fails 24 cases. `index-focus-regressions.js` uses the same runner
and adds 28 cases for Back/Forward with either opener, linked cards, closing cards, and arrow
panning after pointer selection. The first candidate failed all 28; these assertions were frozen
before the correction. The runner brings the task tab forward before input to prevent external
app focus changes from invalidating the input. Same-project reselection and focus through resize
are additional browser smoke checks.

`index-transition-focus.js` adds 8 fast-Tab cases during closing animations; the preceding
candidate failed the 4 cases with normal motion. `pointer-card-focus.js` adds 4 cases for arrow
panning after clicking a linked card. A real-browser reproduction caught the preceding
candidate stealing focus and suppressing that pan. All checks use genuine browser input.

`panel-double-click.js` adds 4 normal-motion cases ensuring double-clicking either Close button
does not reach the canvas and zoom it during the fade. Closed controls leave the Tab order;
the panel keeps its existing pointer handling until the visual transition finishes.

`card-reopen-focus.js` adds 8 first-open/reopen cases for text-click arrow panning. An earlier
candidate retained the closed container's tabindex on reopen and failed the 4 reopened cases.

## The galaxy

Three more files use the same runner and port. `galaxy-levels.js` (18 cases, 1280 and 390 wide)
walks the zoom levels: the page enters on the galaxy with every body a link; a cluster name zooms to
that cluster and its heading; a star opens its card and its solar system, whose planets become links;
a planet opens inside its system; Escape closes the card, then zooms out to the cluster, then the
galaxy; a planet's `#id` deep-links into its system. `hover-card.js` (10 cases, normal and reduced
motion) hovers Empire Earth: the card appears, its recording plays (and stays still under reduced
motion), the card stays while the pointer moves onto it and leaves with the pointer, and a star
without a recording gets a live picture instead. `table-view.js` (10 cases) checks that the table
lists all 82 bodies in map order, that search, the domain filter and sorting by date work, and that
choosing a planet's row flies into its system and moves focus into its card.

The earlier keyboard checks above run unchanged against the galaxy: the index, card, `.chip`
links, `#home-link`, the `I` key and `window.__galaxy().camT` kept their contract.

## The content and the editor

Galaxy checks target `/galaxy.html`; `/` remains the legacy homepage until a deliberate release.

The map reads `content/galaxy.json` through `js/content.js`. `admin.js` (21 cases, 1440 wide) drives the
editor at `/admin/`. It checks that:

- every card is listed;
- an edit shows in the preview of the real site, and visitors don't see it;
- undo restores the edit, IDs stay unique, and an error blocks a save;
- a save writes `content/galaxy.json`;
- moving a star to another domain, adding a planet (its ID follows its title), the card layout, and
  hiding a card all reach the map;
- the phone preview is 390 wide;
- unsaved work survives a reload;
- the site names the problem when the content isn't valid JSON.

It puts `content/galaxy.json` back byte for byte at the end. Breaking the hand-off of the draft to the
preview fails the five preview cases.


## Drafts and publication

`publishing.js` adds 31 hosted-admin browser cases. It uses an isolated GitHub API fixture with
immutable trees, commits, blobs and guarded ref updates. It covers separate draft initialization,
cross-device sync, stale saves, two-tab recovery, upload/create/duplicate/delete, typing during
saving, reload recovery, failed publication, media and page metadata, editor-note stripping,
served-versus-queued release status, Legacy restoration, device-wide disconnect, token expiry and phone layout. It also covers repeated unresolved recovery, copied-tab identities, saved/unsaved/queued media hydration, connected local previews and persistent verification failures.
No fixture calls reach GitHub or production.

Run `python3 tools/check-deploy.py` for three local-Git checks of deployment preservation,
idempotency and exclusion of the removed CV PDF and editor notes. It leaves its isolated fixture
under `~/.local/share/device-agent/work/portfolio-deploy-proof-*`.

The opt-in real protocol proof uses the existing owning GitHub sign-in:

```sh
PORTFOLIO_API_PROOF=1 node tools/check-publishing-api.cjs
```

It makes two uniquely named `admin-proof-*` branches, exercises eight cases against the real
GitHub API, and removes its branches in `finally`. It never writes the actual publishing branches,
`main`, Pages settings or production. It proves first-run normalization, actual non-fast-forward
rejection, unsaved-publication refusal, atomic content/media/metadata release, editor-note stripping
and Legacy restoration. It needs Node 20+ and authenticated `gh` with repository write access.
