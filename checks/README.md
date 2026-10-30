# Index keyboard check

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
