#!/usr/bin/env node
/**
 * apply-canonical-copy — close the §17 loop against the files ingest reads.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Library's dictionary is GENERATED. `scripts/ingest.mjs` wipes and
 * rewrites `src/content/terms/*.md` on every run, from:
 *
 *   1. content-cache/terms-extra/<slug>.md          (in this repo, ~395 terms)
 *   2. ~/Projects/soma-lexicon/SOMA-LEXICON.md      (outside this repo, ~63 terms)
 *
 * So a live edit that only lives in the database — or only in the generated
 * file — is reverted by the next `npm run ingest`, leaving two sources of
 * truth. That is the exact failure SOMA/standards/soma-live-edit forbids.
 *
 * This tool is wired as the FIRST STEP OF `npm run ingest` (see package.json).
 * It patches the upstream sources before ingest regenerates from them, so the
 * command that would otherwise revert Mike's edit is the command that makes it
 * permanent.
 *
 * netlify/functions/copy-canonize.mjs does the same swap in the cloud when Mike
 * clicks "Make canonical", and since 2026-09-16 it retires a row itself once
 * both in-repo layers say the new words. What reaches this tool is what the
 * cloud cannot finish: lexicon terms (SOMA-LEXICON.md is out of its reach), and
 * any row it could not place. This tool reads the source, so it decides whether
 * those rows retire.
 *
 * ── Matching (2026-09-16: the cloud function's matcher, not a looser one) ─────
 *
 * Every row goes through the same rules as copy-canonize.mjs, whose helpers it
 * imports:
 *
 *   - a term with an upstream file in this repo: `planTerm` (both layers or
 *     neither);
 *   - site copy: `planSiteCopy` over the layout and the route's page;
 *   - a lexicon term: the generated file is matched strictly with the clicked
 *     element's tag (`patch`, `tagGate`). That match names the field — title,
 *     subtitle, body or origin — and the lexicon is searched only inside that
 *     slug's `###` entry, only in that field. Where ingest put a link, `<em>`
 *     or `<strong>` next to the generated match, the lexicon match may end at
 *     a word boundary or an asterisk instead. Both files are patched, or
 *     neither.
 *
 * Refused, with the reason printed, rather than guessed:
 *   - two candidates in the entry's field (occurrence counts across the whole
 *     page, so it cannot pick inside one entry);
 *   - a theme: in the lexicon it is a `##` heading shared by every entry under
 *     it, so the edit would not be about one entry;
 *   - a title whose new wording changes the slug: the entry's file name and
 *     every `#term-<slug>` link would change with it;
 *   - new words containing `*` in body or origin text, which ingest would turn
 *     into emphasis.
 *
 * Rows are applied in the order they became canonical (`canonical_at`, then
 * `created_at`), against one in-memory copy of each file, so an undo applies
 * after the edit it undoes.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *   node tools/apply-canonical-copy.mjs            apply + retire what's done
 *   node tools/apply-canonical-copy.mjs --dry-run  report only, touch nothing
 *   node tools/apply-canonical-copy.mjs --no-retire
 *   --rows-file PATH   read rows from a JSON array instead of the database
 *                      (never retires; used for tests and scratch checks)
 *   --lexicon PATH     default ~/Projects/soma-lexicon/SOMA-LEXICON.md
 *
 * Exit 0 = every canonical row is satisfied in its upstream source.
 * Exit 1 = at least one row could not be placed. Loud on purpose: a silent
 *          no-op here is an edit that quietly disappears at the next ingest.
 *          (Estate rule, 2026-08-04: exit codes are not health — so this one
 *          is wired to mean something and prints a per-row verdict.)
 *
 * Reads canonical rows with the PUBLISHABLE key. `copy_overrides` RLS makes
 * canonical rows world-readable by design (they are the site's copy), so no
 * secret is needed to apply them. Retiring needs Mike's Supabase account token
 * from the macOS Keychain; without it the tool applies and says retirement was
 * skipped rather than pretending. SOMA-LEXICON.md is not under version
 * control, so a copy is saved to soma-lexicon/.backups/ before it is written.
 *
 * Matcher rewrite 2026-09-16 (Mike Wolf's estate; Claude Opus 5, CCc).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  flexible, patch, planTerm, planSiteCopy, siteCopyFiles,
  upstreamTermFile, generatedTermFile, yamlValue, yamlQuoted,
} from '../netlify/functions/copy-canonize.mjs';

const APP = 'mike-wolf-library';
const SUPABASE_URL = 'https://omfwcodoimjmbrhssvfl.supabase.co';
const ANON_KEY = 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf';
const PROJECT_REF = 'omfwcodoimjmbrhssvfl';

export const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_LEXICON = join(process.env.HOME || '', 'Projects/soma-lexicon/SOMA-LEXICON.md');
export const LEXICON = 'SOMA-LEXICON.md';   // the store's key for the lexicon file

/* ── the lexicon ──────────────────────────────────────────────────────────── */

// Exactly scripts/ingest.mjs's slugify: a lexicon entry's slug is its title's.
export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

/** The `### title · subtitle` entry whose title slugifies to `slug`, as regions
 * of the text ingest turns into that term: title and subtitle (plain), body
 * paragraphs and the `*Origin.*` text (markdown). `*See also:*` is data.
 * Returns null when no entry has that slug, {ambiguous:true} when two do. */
export function lexiconEntry(text, slug) {
  const lines = [];
  let pos = 0;
  for (const line of text.split('\n')) { lines.push({ line, start: pos }); pos += line.length + 1; }
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s+(.+?)\s*$/.exec(lines[i].line);
    if (!m) continue;
    const rawTitle = m[1].split(/\s+·\s+/)[0].trim();
    if (slugify(rawTitle.replace(/^"|"$/g, '')) !== slug) continue;
    if (at >= 0) return { ambiguous: true };
    at = i;
  }
  if (at < 0) return null;

  const regions = [];
  const head = lines[at];
  const header = /^###\s+(.+?)\s*$/.exec(head.line)[1];
  const headerStart = head.start + head.line.indexOf(header);
  const sep = /\s+·\s+/.exec(header);
  const rawTitle = sep ? header.slice(0, sep.index) : header;
  let tStart = headerStart;
  let tEnd = headerStart + rawTitle.trim().length;
  if (rawTitle.startsWith('"')) tStart += 1;
  if (rawTitle.trim().endsWith('"')) tEnd -= 1;
  regions.push({ field: 'title', kind: 'plain', start: tStart, end: tEnd });
  if (sep) regions.push({ field: 'subtitle', kind: 'plain', start: headerStart + sep.index + sep[0].length, end: headerStart + header.length });

  // Body lines run to the next entry, section or rule (as parseLexicon reads them).
  let bodyStart = null;
  const closeBody = (endPos) => {
    if (bodyStart !== null && text.slice(bodyStart, endPos).trim()) regions.push({ field: 'body', kind: 'md', start: bodyStart, end: endPos });
    bodyStart = null;
  };
  let i = at + 1;
  for (; i < lines.length; i++) {
    const { line, start } = lines[i];
    if (/^#{2,3}\s+/.test(line) || /^---\s*$/.test(line)) break;
    const origin = /^\*Origin\.\*\s*(.+)$/i.exec(line);
    if (origin || /^\*See also:\*/i.test(line)) {
      closeBody(start);
      if (origin) {
        const s = start + line.length - origin[1].length;
        regions.push({ field: 'origin', kind: 'md', start: s, end: s + origin[1].trimEnd().length });
      }
      continue;
    }
    if (bodyStart === null) bodyStart = start;
  }
  closeBody(i < lines.length ? lines[i].start : text.length);
  return { start: head.start, regions };
}

const isWordChar = (c) => Boolean(c) && /[\p{L}\p{N}_]/u.test(c);

/* Is a markdown hit one whole run of what ingest renders as a text node? Its
 * sides must be a paragraph edge (region edge or blank line), or markdown that
 * becomes an element (`*`, `**`, a link's `[` `]`), with spaces allowed. relax:
 * sides where ingest inserted a link next to the page's text node, so a word
 * boundary is enough there. */
function mdWhole(text, r, index, length, relax) {
  const end = index + length;
  const lead = text.slice(r.start, index);
  const tail = text.slice(end, r.end);
  if (/\n[ \t]*\n/.test(text.slice(index, end))) return false;   // never across paragraphs
  let okBefore = /^\s*$/.test(lead) || /\n[ \t]*\n\s*$/.test(lead) || /[*[\])][ \t]*$/.test(lead);
  let okAfter = /^\s*$/.test(tail) || /^\s*\n[ \t]*\n/.test(tail) || /^[ \t]*[*[\]]/.test(tail);
  if (!okBefore && relax?.before) okBefore = !(isWordChar(text[index - 1]) && isWordChar(text[index]));
  if (!okAfter && relax?.after) okAfter = !(isWordChar(text[end - 1]) && isWordChar(text[end]));
  return okBefore && okAfter;
}

function lexiconHits(text, regions, literal, relax) {
  const out = [];
  for (const r of regions) {
    const sub = text.slice(r.start, r.end);
    const re = flexible(literal, { entities: r.kind === 'md', quote: '' });
    for (const m of sub.matchAll(re)) {
      const index = r.start + m.index;
      const ok = r.kind === 'plain'
        ? text.slice(r.start, index).trim() === '' && text.slice(index + m[0].length, r.end).trim() === ''
        : mdWhole(text, r, index, m[0].length, relax);
      if (ok) out.push({ index, length: m[0].length, region: r });
    }
  }
  return out;
}

/** One lexicon entry, one field. {state:'patched'|'already'|'no-match'|
 * 'ambiguous:N-matches'|'refused:<why>', text, hit}. */
export function patchLexicon(text, slug, field, row, relax = null) {
  if (field === 'theme') return { state: 'refused:the-theme-is-a-lexicon-section-heading-shared-by-every-entry-under-it', text };
  const entry = lexiconEntry(text, slug);
  if (!entry) return { state: 'no-match:no-lexicon-entry-with-this-slug', text };
  if (entry.ambiguous) return { state: 'refused:two-lexicon-entries-have-this-slug', text };
  const regions = entry.regions.filter((r) => r.field === field);
  if (!regions.length) {
    // An entry without an *Origin.* line shows ingest's default origin
    // (INTERNAL_CANON_ORIGIN in scripts/ingest.mjs), which is not in the lexicon.
    return field === 'origin'
      ? { state: 'refused:the-entry-has-no-Origin-line;-the-page-shows-the-default-from-scripts/ingest.mjs', text }
      : { state: `no-match:entry-has-no-${field}`, text };
  }

  const newText = row.new_text.replace(/\s+/g, ' ').trim();
  if (field === 'title' && slugify(newText.replace(/^"|"$/g, '')) !== slug) {
    return { state: 'refused:the-new-title-changes-the-slug-and-so-the-entry-file-and-its-links', text };
  }
  if ((field === 'body' || field === 'origin') && newText.includes('*')) {
    return { state: 'refused:an-asterisk-would-become-emphasis-in-ingest', text };
  }
  if (field === 'origin' && /[<>]/.test(newText)) {
    return { state: 'refused:ingest-renders-the-origin-line-as-HTML-so-<-and->-would-become-markup', text };
  }

  const find = (literal) => {
    const strict = lexiconHits(text, regions, literal, null);
    return strict.length || !(relax?.before || relax?.after) ? strict : lexiconHits(text, regions, literal, relax);
  };
  const orig = find(row.original_text);
  if (!orig.length) {
    return { state: find(row.new_text).length === 1 ? 'already' : 'no-match', text };
  }
  if (orig.length > 1) return { state: `ambiguous:${orig.length}-matches`, text };
  const hit = orig[0];
  return { state: 'patched', text: text.slice(0, hit.index) + newText + text.slice(hit.index + hit.length), hit };
}

/* ── one row ──────────────────────────────────────────────────────────────── */

const hintSlug = (row) =>
  ((row.note || '').match(/^term:(.+)$/) || (row.element_path || '').match(/^article#term-(.+)$/) || [])[1] || null;

/* The generated file keeps `origin:` and `source:` as unrendered copies of the
 * lexicon origin text. Keep them level, so the next ingest reproduces the file. */
function syncOrigin(generated, before, after) {
  return generated.replace(/^(origin|source):[ \t]*(.*?)[ \t]*$/gm, (line, key) =>
    yamlValue(`---\n${line}\n---`, key) === before ? `${key}: ${yamlQuoted(after)}` : line);
}

/** Plan one row against a store ({read(path) -> text|null}). Pure: returns the
 * writes, does not make them. {ok, retire, writes:[{path,content}], where, reason}. */
export function planRow(row, store) {
  const slug = hintSlug(row);
  if (!slug) {
    const files = siteCopyFiles(row.route).map((p) => [p, store.read(p)]);
    const plan = planSiteCopy(files, row);
    return { ok: plan.retire, retire: plan.retire, writes: plan.changes, where: 'site copy', reason: plan.reason };
  }

  const genPath = generatedTermFile(slug);
  const upPath = upstreamTermFile(slug);
  const upstream = store.read(upPath);
  const generated = store.read(genPath);
  if (upstream !== null) {
    const plan = planTerm(slug, { upstream, generated }, row);
    return { ok: plan.retire, retire: plan.retire, writes: plan.changes, where: `terms-extra/${slug}`, reason: plan.reason };
  }

  // A lexicon term.
  if (generated === null) return { ok: false, retire: false, writes: [], where: slug, reason: `no generated file for ${slug}` };
  const lexicon = store.read(LEXICON);
  if (lexicon === null) return { ok: false, retire: false, writes: [], where: slug, reason: 'SOMA-LEXICON.md not found' };
  const g = patch(genPath, generated, row, { tagGate: true });
  if (!g.hit) return { ok: false, retire: false, writes: [], where: slug, reason: `generated:${g.state}` };
  const field = g.hit.region.field;
  const relax = { before: g.hit.inlineBefore, after: g.hit.inlineAfter };
  const l = patchLexicon(lexicon, slug, field, row, relax);
  const done = (s) => s === 'patched' || s === 'already';
  if (!done(l.state)) return { ok: false, retire: false, writes: [], where: `lexicon ${slug} ${field}`, reason: `lexicon:${l.state}` };

  const writes = [];
  if (l.state === 'patched') writes.push({ path: LEXICON, content: l.text });
  let genText = g.state === 'patched' ? g.text : generated;
  if (field === 'origin' && l.state === 'patched') {
    const oldOrigin = lexicon.slice(l.hit.region.start, l.hit.region.end).trim();
    const newOrigin = l.text.slice(l.hit.region.start, l.hit.region.end + (l.text.length - lexicon.length)).trim();
    genText = syncOrigin(genText, oldOrigin, newOrigin);
  }
  if (genText !== generated) writes.push({ path: genPath, content: genText });
  return { ok: true, retire: true, writes, where: `lexicon ${slug} ${field}`, reason: null };
}

/** Oldest canonical first, so an undo lands after its edit. */
export const byCanonicalOrder = (a, b) =>
  String(a.canonical_at || '9999').localeCompare(String(b.canonical_at || '9999'))
  || String(a.created_at || '').localeCompare(String(b.created_at || ''));

/** Plan every row in order over one in-memory store. */
export function planRows(rows, read) {
  const cache = new Map();
  const store = { read: (p) => (cache.has(p) ? cache.get(p) : (cache.set(p, read(p)), cache.get(p))) };
  const results = [];
  for (const row of [...rows].sort(byCanonicalOrder)) {
    const r = planRow(row, store);
    for (const w of r.writes) cache.set(w.path, w.content);
    results.push({ row, ...r });
  }
  const dirty = new Set(results.flatMap((r) => r.writes.map((w) => w.path)));
  return { results, files: [...dirty].map((p) => ({ path: p, content: cache.get(p) })) };
}

/* ── data + main ──────────────────────────────────────────────────────────── */

async function canonicalRows() {
  const url =
    `${SUPABASE_URL}/rest/v1/copy_overrides` +
    `?app=eq.${APP}&status=eq.canonical` +
    `&select=id,route,original_text,new_text,occurrence,note,status,element_path,element_tag,canonical_at,created_at` +
    `&order=canonical_at.asc.nullslast,created_at.asc`;
  const res = await fetch(url, { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function keychainToken() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

function retire(ids, token) {
  const sql = `update public.copy_overrides set status='retired', retired_at=now()
               where id in (${ids.map((i) => `'${i}'`).join(',')}) and status='canonical';`;
  // Management API, not the REST endpoint: retirement is a fleet action, not a
  // browser one, and this avoids putting a service-role key on disk.
  const out = execFileSync('curl', [
    '-sS', '-X', 'POST', `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    '-A', 'curl/8.4',
    '--data', JSON.stringify({ query: sql }),
  ], { encoding: 'utf8' });
  if (/"message"/.test(out)) throw new Error(`retire failed: ${out.slice(0, 200)}`);
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const DRY = argv.includes('--dry-run');
  const rowsFile = arg('--rows-file');
  const NO_RETIRE = argv.includes('--no-retire') || Boolean(rowsFile);
  const root = DEFAULT_ROOT;
  const lexiconPath = arg('--lexicon') || DEFAULT_LEXICON;

  const rows = rowsFile ? JSON.parse(readFileSync(rowsFile, 'utf8')) : await canonicalRows();
  if (!rows.length) {
    console.log('copy:apply — no canonical overrides. Nothing to write back.');
    return 0;
  }
  console.log(`copy:apply — ${rows.length} canonical override(s) for ${APP}${DRY ? '  [dry-run]' : ''}${rowsFile ? `  [rows from ${rowsFile}]` : ''}`);

  const onDisk = (p) => {
    const abs = p === LEXICON ? lexiconPath : join(root, p);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  const { results, files } = planRows(rows, onDisk);

  let failed = 0;
  for (const r of results) {
    const short = r.row.original_text.replace(/\s+/g, ' ').slice(0, 54);
    const to = r.row.new_text.replace(/\s+/g, ' ').slice(0, 54);
    if (r.ok) {
      const wrote = r.writes.map((w) => w.path.replace('src/content/terms/', 'terms/').replace('content-cache/terms-extra/', 'terms-extra/'));
      console.log(`   ✓ "${short}" → "${to}"`);
      console.log(`     ${r.where}${wrote.length ? `   patched: ${wrote.join(', ')}` : '   (already said it)'}`);
    } else {
      failed++;
      console.log(`   ✗ "${short}" → "${to}"`);
      console.log(`     ${r.where}: ${r.reason}. NOT placed; ingest would revert this edit.`);
    }
  }

  if (DRY) {
    console.log(`\n[dry-run] would write ${files.length} file(s), retire ${NO_RETIRE ? 0 : results.filter((r) => r.retire).length}`);
  } else {
    for (const f of files) {
      const abs = f.path === LEXICON ? lexiconPath : join(root, f.path);
      if (f.path === LEXICON) {
        // Not under version control: keep the version this run replaces.
        const dir = join(dirname(lexiconPath), '.backups');
        mkdirSync(dir, { recursive: true });
        copyFileSync(lexiconPath, join(dir, `SOMA-LEXICON.${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
      }
      writeFileSync(abs, f.content);
    }
    console.log(`\nwrote ${files.length} file(s)`);
    const retirable = results.filter((r) => r.retire && r.row.id).map((r) => r.row.id);
    if (retirable.length && !NO_RETIRE) {
      const tok = keychainToken();
      if (tok) {
        retire(retirable, tok);
        console.log(`retired ${retirable.length} override(s) — the source now says it, so the row is history (§17a R4: never promotable again)`);
      } else {
        console.log(`NOT retired (${retirable.length}) — no Supabase token in Keychain. Sources are patched; rows stay canonical.`);
      }
    }
  }

  if (failed) {
    console.error(`\ncopy:apply FAILED — ${failed} override(s) could not be placed.`);
    return 1;
  }
  console.log('copy:apply OK — every canonical override is in an upstream source.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
