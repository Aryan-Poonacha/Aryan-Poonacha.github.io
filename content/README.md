# Editing the site

Everything the galaxy says lives in one file, `content/galaxy.json`. The editor at `/admin/` edits it
with a live preview of the real site. You can also edit the file by hand.

## Edit from any device

Open [the admin](https://aryan-poonacha.github.io/admin/) on an existing Tailscale-connected device.
It redirects to the private HTTPS editor. Use the password saved in **Portfolio Website Admin**
in 1Password. Sign-in is remembered for 30 days with a Secure, HttpOnly cookie. Disconnect signs
out the device and its open editor tabs. Changing the item's password invalidates existing
sessions within a minute. No GitHub token setup is needed: the hub uses its existing owner login.
Browser-only drafts transfer to the private editor; their original copies remain on the public
origin. `?recover` on the old admin retains the original owner-token recovery flow.

1. Sign in. The editor connects GitHub and loads the latest **cloud draft**.
2. Edit the cards, domains, organisation, site text, card sections and page/share metadata.
   Add, duplicate, delete or move cards with buttons or drag and drop. Undo restores deletions.
3. **Save draft** / Ctrl+S syncs to `portfolio-drafts`. It never changes the live branch.
4. Preview the real galaxy beside the form, as a map, hover card or detail card; choose phone
   or desktop. **Legacy preview** opens the original site. The preview includes draft uploads.
   On a phone, Show card/hover moves to the preview; Back to editor returns to the form.
5. When ready, open **Publish & live state**, choose Galaxy, tick that you checked the preview,
   and publish. Unsaved changes and content errors block galaxy publication.
6. Check live state after deployment. A queued release is shown separately from what the public
   website actually serves. Choose Legacy and publish to switch back while keeping galaxy work.

Draft content and uploads live in GitHub, so another device can load them. Every save is a commit;
old versions remain in Git history. If two devices edit the same starting version, the second save
is refused rather than overwriting the first. Download its browser copy, then **Load cloud draft**;
Undo also keeps the local version you replaced. Browser-only edits have per-tab recovery and a
restore banner after reload, including repeated reloads before restoring. Copies of an open tab keep separate recovery records. Save draft before moving between devices.
Publishing also refuses a draft superseded by another device until you load and review it.

Uploads use immutable names, so replacing a video cannot alter a published video. A release changes
the homepage, content, media and release state in **one commit**. Publishing never writes `main`.
The `portfolio-live` branch serves GitHub Pages. Deployment usually takes a minute or two.
The initial homepage is the original legacy HTML, byte for byte. `galaxy.html` is the preview engine.

This repository is public: draft JSON and uploads on its branches are **not private**. Editor notes
and review flags are removed from published galaxy JSON, but remain in repository draft history.
Drafts are excluded from the default homepage until explicitly published. The private server
requires a password session before serving editor files or accessing GitHub. Its API permits only
draft save, media upload and deliberate publication, with version checks and same-origin write
protection. GitHub credentials and the password never enter website source or browser storage.
GitHub still enforces repository permissions. Public repository files and branches remain readable.
The TUF must be online for hosted editing; the public site remains on GitHub Pages independently.
The loopback-only local editor server still opens without a token.

The private server runs as `portfolio-admin.service`, on an owner-only Unix socket behind the
existing Tailscale Serve HTTPS listener. Its private policy contains an origin and an `op://`
reference to the existing item's password, never the value. `tools/private-admin.cjs --root PATH
--policy PATH --socket PATH` starts it; the systemd service caps memory and restarts failures.

## Local editing and maintenance

```sh
python3 tools/edit.py
```

Without GitHub connected, Save writes `content/galaxy.json` in this checkout and keeps up to
50 earlier copies in ignored `content/.backups/`. Local saves do not change production. Connected
local editing uses cloud drafts, just like the hosted admin. Live status always checks production.
**Save as…** downloads JSON or imports a file. The legacy homepage is a preserved snapshot;
content editing and preview apply to the galaxy.

After verified code changes, `python3 tools/deploy.py --push` updates only `portfolio-live`,
preserving the selected view, published content, share metadata, and uploaded media. Without
`--push` it prints an inspectable commit. A concurrent release rejects deployment rather than
losing it. `main` and `portfolio-drafts` are not changed by this tool. The first deployment excludes
the removed CV PDF. Pages is configured to serve `portfolio-live` at `/`.

## How the content is organised

The file follows the map, from the inside out:

- `site` is the text around the map: name, tagline, the opening, hints, links, the words the
  interface uses, and the **card layout** (which sections the hover card and the card show, in order).
  A missing or empty name, tagline, opening or hint shows nothing. The interface words fall back to defaults.
- `kinds` are the labels for each kind of card (Project, Role, Book…). `interest` draws as a ring.
- `path` is the lit line through cards in order. By default it is the career: M.Eng. → Lightfield → Tomex.
- `core` is the centre star (you), with its own planets.
- `domains` are the clusters, each with a colour, a position (`angle`) and a `heart` star. Each domain
  holds its `stars` in reading order. A star with `planets` has a solar system you can zoom into.
- `connections` are pairs of card IDs. They are drawn as lines and listed under “Where it meets”.

A star or planet has these fields. Only `id` and `title` are required:

| Field | Shows |
|---|---|
| `title` | The card's heading |
| `mapLabel` | A shorter name on the map (optional) |
| `mapNote` | The small line under the label, in the table and on planet chips |
| `kind` | One of `kinds`, at the top of the card |
| `size` | Stars only, 1–5: how bright the star is. 4 and 5 get light spikes |
| `when`, `year` | Dates as shown, and a year number for sorting |
| `subtitle` | One line under the title |
| `summary` | Opens the hover card and the card |
| `body` | Paragraphs. The first one also shows on hover |
| `builtWith` | One line of tools |
| `media` | `video` (`src`, `poster`), `image` (`src`, `square`), `book` (`title`, `author`) or `quote` (`quote`, `cite`); `caption` is optional |
| `links` | `{ "label", "url" }` items. The first three also show on hover |
| `reviewed` | Your own tick, for working through the cards. Not shown on the site |
| `hidden` | Keeps the card off the site without deleting it |
| `notes` | Editor notes, removed from published JSON; readable in repository history |

In `summary` and `body`, `[words](https://…)` makes a link, `**words**` is bold and `*words*` is
italic. Media files go in `assets/media/`. The editor can upload them and can make a video's poster
from one of its frames.

## Hand edits

The file is plain JSON. After a hand edit, open the site. If the JSON is broken, the site says so
and names the problem. The editor re-saves in the same layout, so diffs stay small.
The page title, description, sharing image and social handle are editable under Site text & card layout → Page and sharing. Publication writes them into the HTML head too.

The Empire Earth write-up also reads the `eenote` card's title, dates, summary and body.
Edit that card to update both its detail view and the standalone reading page. A paragraph
containing only `**a heading**` becomes a section heading on the reading page.
The original public Google Docs résumé link is retained; the removed personal PDF is not deployed.
