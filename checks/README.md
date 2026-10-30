# Index keyboard check

Serve this checkout on loopback port4187 with `python3 -m http.server 4187 --bind 127.0.0.1`.
`index-keyboard.js` is an async function accepting a Playwright `page`. Run it in an existing
Playwright environment, or pass its contents to the Playwright browser tool's code runner.
It returns `ok` and40 per-case results covering1280/390 widths and normal/reduced motion.

Use a fresh browser context, or reload the page and revalidate cached assets when switching
checkouts behind the same URL. Keep the task tab focused for genuine keyboard input. The function
uses real Enter, Escape, I, Tab and Shift+Tab events; DOM state is read only for assertions.
The original48263c8 preview fails24 cases; the fix passes all40. Pointer selection, same-project
reselection and focus through resize are additional manual browser smoke checks.
