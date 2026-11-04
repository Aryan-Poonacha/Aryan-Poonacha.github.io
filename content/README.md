# Editing the site

Everything the site says lives in one file, `content/galaxy.json`. The editor at `/admin/` edits it
with a live preview of the real site. You can also edit the file by hand.

## Start the editor

```sh
python3 tools/edit.py
```

This opens `http://127.0.0.1:4000/admin/`. Saves (Save or Ctrl+S) go straight into this checkout's
`content/galaxy.json`, and the previous version is copied to `content/.backups/`, which git ignores.
Commit and push with git when you are ready. Nothing in the editor publishes the site.

On the published site, `/admin/` can also commit to GitHub through **Save as…**. That needs a
fine-grained token for this repository with Contents: read and write. A commit to `main` publishes the
site; a commit to any other branch does not.

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
| `notes` | Private notes. Never shown |

In `summary` and `body`, `[words](https://…)` makes a link, `**words**` is bold and `*words*` is
italic. Media files go in `assets/media/`. The editor can upload them and can make a video's poster
from one of its frames.

## Hand edits

The file is plain JSON. After a hand edit, open the site. If the JSON is broken, the site says so
and names the problem. The editor re-saves in the same layout, so diffs stay small.
The page title, the search description and the link-preview image are in `index.html`'s `<head>`.
