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
