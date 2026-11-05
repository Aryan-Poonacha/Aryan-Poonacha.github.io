# Browser checks

From a fresh checkout (Node 20+ and Python 3):

```sh
npm ci
npx playwright install chromium
npm test
# Quick check of one flow:
npm test -- publishing.js
```

The runner starts the local editor server on port 4187 if needed, verifies an existing
server belongs to this checkout, runs checks serially in fresh browser contexts, and writes
`test-results/browser.json`. It stops only a server it started. Browser checks never publish
to production. `touch.js` uses real Chromium touch input to check pinch-to-drag transitions.
`note.js` covers editable note rendering, safe links, hiding and phone layout.

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

`node --test checks/private-admin.cjs` checks password/session protection, CSRF rejection, proxy
headers, rate limits, password rotation and constrained publishing with stale-version protection.
`node checks/password-flow.cjs` drives the real password form and editor through HTTPS-origin
request routing into the isolated backend fixture. It checks remembered cookies, draft save/reload,
recovery, phone layout and logout; it cannot reach production GitHub. Both use deliberate fixture
passwords. `PORTFOLIO_EVIDENCE_DIR` captures this flow outside Git when supplied.

`access.js` verifies the hosted editor stays locked for anonymous visitors, forged browser flags,
another account (even with a spoofed owner name), expired/read-only tokens, rate limits and network
failures. It covers owner sign-in, tab-only and remembered sessions, GitHub-only credential headers,
cross-tab logout, keyboard access while locked, token revalidation, phone layout and JavaScript
disabled. It makes no repository writes. The loopback-only server remains available to local checks.
Use `PORTFOLIO_CHECK_OUTPUT=/absolute/external/directory npm test` to keep check reports outside Git;
`PORTFOLIO_EVIDENCE_DIR=/absolute/external/directory` records the access check and captures its sign-in
screen. The recording uses isolated fixture credentials and never reaches GitHub.

`publishing.js` checks the hosted admin using an isolated GitHub API fixture with
immutable trees, commits, blobs and guarded ref updates. It covers separate draft initialization,
cross-device sync, stale saves, two-tab recovery, upload/create/duplicate/delete, typing during
saving, reload recovery, failed publication, media and page metadata, editor-note stripping,
served-versus-queued release status, Legacy restoration, device-wide disconnect, token expiry and phone layout. It also covers repeated unresolved recovery, copied-tab identities, saved/unsaved/queued media hydration, connected local previews and persistent verification failures.
It rejects publication from a superseded draft, preserves uploads through Undo, protects newer
media choices, rejects malformed imports without replacing the editor, and brings phone previews
into view with a return button. Connected local editing hides the disk-save option.
No fixture calls reach GitHub or production.

Run `python3 tools/check-deploy.py` for three local-Git checks of deployment preservation,
idempotency and exclusion of the removed CV PDF and editor notes. It leaves its isolated fixture
under `~/.local/share/device-agent/work/portfolio-deploy-proof-*`.

The opt-in real protocol proof uses the existing owning GitHub sign-in:

```sh
PORTFOLIO_API_PROOF=1 node tools/check-publishing-api.cjs
```

It makes two uniquely named `admin-proof-*` branches, exercises nine cases against the real
GitHub API, and removes its branches in `finally`. It never writes the actual publishing branches,
`main`, Pages settings or production. It proves first-run normalization, actual non-fast-forward
rejection, unsaved-publication refusal, atomic content/media/metadata release, editor-note stripping
and Legacy restoration. It needs Node 20+ and authenticated `gh` with repository write access.
