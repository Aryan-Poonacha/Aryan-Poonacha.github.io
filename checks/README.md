# Browser checks

Serve this checkout on loopback port 4187 with `python3 -m http.server 4187 --bind 127.0.0.1`.
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
