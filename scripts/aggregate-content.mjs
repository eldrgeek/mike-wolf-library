#!/usr/bin/env node
/**
 * Build src/data/search-index.json — the client-side MiniSearch corpus.
 * Runs before every `astro build`. Indexes BOTH collections (terms + sources)
 * with full body text so the search box returns real hits, entirely client-side
 * (zero per-query cost, no backend).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const TERMS_DIR = join(ROOT, 'src/content/terms');
const SOURCES_DIR = join(ROOT, 'src/content/sources');
const OUT = join(ROOT, 'public/search-index.json');

function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  const re = /^([a-zA-Z0-9_-]+):\s*(.*)$/gm;
  let mm;
  while ((mm = re.exec(m[1])) !== null) {
    const v = mm[2].trim();
    if (v) data[mm[1]] = v.replace(/^["']|["']$/g, '');
  }
  return { data, body: m[2] };
}

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/[#*_>`]+/g, ' ').replace(/\s+/g, ' ').trim();

const docs = [];

for (const f of readdirSync(TERMS_DIR).filter(f => f.endsWith('.md'))) {
  const { data, body } = parse(readFileSync(join(TERMS_DIR, f), 'utf8'));
  const slug = f.replace(/\.md$/, '');
  docs.push({
    id: `term:${slug}`,
    kind: 'term',
    slug,
    title: data.title || slug,
    subtitle: data.subtitle || '',
    collection: data.theme || 'Dictionary',
    url: `/dictionary/#term-${slug}`,
    text: strip(body).slice(0, 1200),
  });
}

for (const f of readdirSync(SOURCES_DIR).filter(f => f.endsWith('.md'))) {
  const { data, body } = parse(readFileSync(join(SOURCES_DIR, f), 'utf8'));
  const slug = f.replace(/\.md$/, '');
  docs.push({
    id: `source:${slug}`,
    kind: 'source',
    slug,
    title: data.title || slug,
    subtitle: data.subtitle || '',
    collection: data.collection || 'Corpus',
    url: `/corpus/${slug}/`,
    text: strip(body).slice(0, 4000),
  });
}

if (!existsSync(join(ROOT, 'public'))) mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(OUT, JSON.stringify(docs));
console.log(`Aggregated ${docs.length} docs → public/search-index.json (${(JSON.stringify(docs).length / 1024).toFixed(0)} KB)`);
