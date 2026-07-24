#!/usr/bin/env python3
"""
Build public/atlas.json for the semantic Atlas page.

  - Embeds all dictionary terms + all corpus sources with BAAI/bge-large-en-v1.5
  - Projects to 2D (and 3D) via UMAP
  - Draws edges from term.provenance (term -> source it's discussed in)
  - Writes public/atlas.json

Run LOCALLY before deploy; atlas.json is committed as a pre-built artifact.
The Netlify build does NOT run this (no ML deps in the build env).

Setup (one-time):
  python3 -m venv venv && source venv/bin/activate
  pip install sentence-transformers umap-learn
  python scripts/build_atlas.py
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).parent.parent
TERMS_DIR = ROOT / "src/content/terms"
SOURCES_DIR = ROOT / "src/content/sources"
OUT_FILE = ROOT / "public/atlas.json"
MODEL_NAME = "BAAI/bge-large-en-v1.5"
UMAP_PARAMS = dict(n_neighbors=12, min_dist=0.15, metric="cosine", random_state=42)


def parse_fm(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)", text, re.DOTALL)
    if not m:
        return {}, text
    fm, body = m.group(1), m.group(2)
    data = {}
    for line in fm.split("\n"):
        sm = re.match(r'^([a-zA-Z0-9_-]+):\s*(.*)$', line)
        if sm and sm.group(2).strip():
            data[sm.group(1)] = sm.group(2).strip().strip('"\'')
    # list fields
    for key in ("provenance", "related"):
        lm = re.search(rf'^{key}:\s*\n((?:\s*-\s.+\n?)+)', fm, re.MULTILINE)
        data[key] = [i.strip().strip('"\'') for i in re.findall(r'-\s(.+)', lm.group(1))] if lm else []
    return data, body


def clean(body, limit=500):
    t = re.sub(r"<[^>]+>", " ", body)
    t = re.sub(r"[#*_>`]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def read_terms():
    out = []
    for f in sorted(TERMS_DIR.glob("*.md")):
        data, body = parse_fm(f.read_text(encoding="utf-8"))
        title = data.get("title", f.stem)
        sub = data.get("subtitle", "")
        out.append({
            "id": "term:" + f.stem, "slug": f.stem, "type": "term",
            "title": title, "subtitle": sub or None,
            "provenance": data.get("provenance", []),
            "embed_text": f"{title}. {sub}. {clean(body)}".strip(),
            "url": f"/dictionary/#term-{f.stem}",
        })
    return out


def read_sources():
    out = []
    for f in sorted(SOURCES_DIR.glob("*.md")):
        data, body = parse_fm(f.read_text(encoding="utf-8"))
        title = data.get("title", f.stem)
        coll = data.get("collection", "")
        out.append({
            "id": "source:" + f.stem, "slug": f.stem, "type": "source",
            "title": title, "subtitle": coll or None,
            "embed_text": f"{title}. {clean(body, 700)}".strip(),
            "url": f"/corpus/{f.stem}/",
        })
    return out


def embed(texts):
    from sentence_transformers import SentenceTransformer
    print(f"  Loading {MODEL_NAME}…")
    model = SentenceTransformer(MODEL_NAME)
    print(f"  Embedding {len(texts)} texts…")
    return model.encode(texts, show_progress_bar=True, normalize_embeddings=True, batch_size=16)


def project(emb, n):
    import umap
    return umap.UMAP(n_components=n, **UMAP_PARAMS).fit_transform(emb)


def main():
    terms = read_terms()
    sources = read_sources()
    print(f"  {len(terms)} terms, {len(sources)} sources")
    source_ids = {"source:" + s["slug"] for s in sources}

    items = terms + sources
    emb = embed([i["embed_text"] for i in items])
    c3 = project(emb, 3)
    c2 = project(emb, 2)

    points = []
    for i, it in enumerate(items):
        x3, y3, z3 = (round(v, 4) for v in c3[i].tolist())
        x2, y2 = (round(v, 4) for v in c2[i].tolist())
        points.append({
            "id": it["id"], "type": it["type"], "title": it["title"],
            "subtitle": it["subtitle"],
            "x3": x3, "y3": y3, "z3": z3, "x2": x2, "y2": y2,
            "url": it["url"],
        })

    # edges: term -> source (provenance)
    edges = []
    for t in terms:
        for prov in t["provenance"]:
            tgt = "source:" + prov
            if tgt in source_ids:
                edges.append({"source": t["id"], "target": tgt, "kind": "discussed-in"})

    atlas = {"points": points, "edges": edges,
             "stats": {"terms": len(terms), "sources": len(sources), "edges": len(edges)}}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(atlas, separators=(",", ":")), encoding="utf-8")
    print(f"\nWrote {OUT_FILE.relative_to(ROOT)} ({OUT_FILE.stat().st_size/1024:.1f} KB)")
    print(f"Stats: {atlas['stats']}")


if __name__ == "__main__":
    main()
