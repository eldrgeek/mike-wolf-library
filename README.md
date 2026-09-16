# The Library — library.mike-wolf.com

An indexed, cross-referenced public archive of Mike Wolf's writing: a working
**dictionary** of terms (the SOMA Lexicon) and the long-form **corpus** they came
from (the SRMW book, the Silicon Children manifesto, 70 Years WTF and AI WTF posts).

Fully static, fully public, **$0 per query**. Astro + Tailwind + client-side MiniSearch.
No backend, no auth, no LLM "ask" — search and browse and an offline-built semantic atlas.

## Structure
- `src/content/terms/*.md`   — dictionary entries (cross-referenced)
- `src/content/sources/*.md` — long-form corpus sources (full text, rendered on reading pages)
- `scripts/ingest.mjs`        — the reusable ingest adapter (source formats -> collections)
- `scripts/aggregate-content.mjs` — builds `public/search-index.json` (client search corpus)
- `scripts/build_atlas.py`    — offline: embeds + UMAP-projects the corpus -> `public/atlas.json`

## Build
```
npm run ingest    # regenerate content collections from on-disk sources
npm run build     # aggregate search index + astro build  (Netlify runs this)
```
Atlas (offline, one-time / on content change):
```
python3 -m venv venv && ./venv/bin/pip install sentence-transformers umap-learn
./venv/bin/python scripts/build_atlas.py
```
The Netlify build does NOT run Python — `atlas.json` is committed as an artifact.

## Extending (Phase 2)
Add a parser function to `scripts/ingest.mjs` that emits `sourceRecords` (e.g. a
scraper for the full 70 Years WTF Substack back-catalogue). Cross-references wire
themselves — new sources light up existing dictionary terms automatically.

## Editing the copy in place (SOMA §17 / §17a)

Go to any page with `?edit=1`, sign in as an app admin, and a small bar appears
bottom-left.

1. **Edit copy** → click any sentence → type → **Enter**. Saved as a draft.
2. **Review** → each row gets three answers, not two: **Make canonical**,
   **Revise** (rewrite it right there — this is §17a's whole point), **Drop**.
3. **Make canonical** writes the new wording back into the **source file** and
   commits it. Netlify redeploys and a logged-out visitor reads the edit out of
   static HTML.

### The read path is untouched — verify it, don't take my word for it

The Library is a public archive that costs $0 per query, and adding an editor
must not change that. The bootstrap in `src/layouts/Base.astro` makes **zero
requests** unless you are on the admin path, and canonical copy is never served
from a database — it is in the HTML, because canonize put it there.

```
# an anonymous visitor's requests, counted in a real browser:
#   13 total, 0 to supabase.co, 0 to live-edit.js, window.SomaLiveEdit undefined
```

### The wrinkle: the dictionary is GENERATED

`scripts/ingest.mjs` wipes and rewrites `src/content/terms/` on every run from
`content-cache/terms-extra/` and `~/Projects/soma-lexicon/SOMA-LEXICON.md`. An
override stored only in the database — or only in the generated file — is
reverted by the next `npm run ingest`, leaving two sources of truth. So the
loop closes to the file, twice over:

| | what it does | reaches |
|---|---|---|
| `netlify/functions/copy-canonize.mjs` | one GitHub commit patching the upstream source **and** the generated file, or nothing; retires the row once both say the new words | anything in this repo. Immediate, no human. |
| `tools/apply-canonical-copy.mjs` | patches upstream, then decides retirement by **reading** the source — the rows left for it are lexicon terms and anything canonize could not place | also `SOMA-LEXICON.md`, which lives in another repo |

`npm run ingest` runs the second one **first** — so the command that would
revert Mike's edit is the command that makes it permanent. Run it standalone
with `npm run copy:apply` (`--dry-run` to look without touching). It exits
non-zero if any canonical override has no upstream home, because a silent no-op
there is an edit that quietly disappears.

### The safety boundary

**The archive is not editable.** `src/pages/corpus/*` marks post bodies, index
rows, runtime search snippets and the atlas tooltip with `data-user-content`,
and the engine refuses to walk into them. Those ~759 posts are published
originals; editing one in place and canonizing it would silently fork the
archive from what Mike actually published, and the fork would be invisible
because the page would still look like the archive. Dictionary entries,
headings, nav and site copy stay editable — that is the point.

Verified by clicking, not by reading: with edit mode on, clicking an archive
paragraph refuses and says why.

### Notes for whoever touches this next

- `public/js/live-edit.js` is **byte-identical** to `mike-wolf-com/js/live-edit.js`.
  Everything site-specific is in the `window.SOMA_LIVE_EDIT` config the page
  sets. If the two files differ, one of them is wrong.
- Storage is the shared `copy_overrides` table (RLS `is_app_admin(app)`,
  canonical rows world-readable). It was already multi-app — **no migration
  was needed**.
- Under `netlify dev`, browse the **Astro port (4321), not 8888**. The
  catch-all `/* -> /index.html` in `netlify.toml` swallows Vite's dev module
  graph and you get a blank page with no error. The function is unaffected in
  production: it declares its own path via Functions 2.0 `config`, and function
  paths match before redirects.

_§17/§17a adopted 2026-08-10 by Mike Wolf + Quill (Claude Opus 5, CCc), porting
`SOMA/standards/soma-live-edit/` and the `a-different-mind` Tier 1 precedent._
