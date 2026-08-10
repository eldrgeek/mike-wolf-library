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
 *   2. ~/Projects/soma-lexicon/SOMA-LEXICON.md      (another repo, ~62 terms)
 *
 * So a live edit that only lives in the database — or only in the generated
 * file — is reverted by the next `npm run ingest`, leaving two sources of
 * truth. That is the exact failure SOMA/standards/soma-live-edit forbids.
 *
 * This tool is wired as the FIRST STEP OF `npm run ingest` (see package.json).
 * It patches the upstream sources before ingest regenerates from them, so the
 * command that would otherwise revert Mike's edit is the command that makes it
 * permanent. Running ingest without it is not possible through the npm script.
 *
 * netlify/functions/copy-canonize.mjs does the same swap in the cloud at the
 * moment Mike clicks "Make canonical" (so the change ships in ~90s without a
 * human), but it can only reach files in THIS repo. SOMA-LEXICON.md lives in
 * another one. This tool covers both, and is the thing that decides a row is
 * `retired` — because only something that has READ the source can honestly say
 * the source has caught up.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *   node tools/apply-canonical-copy.mjs            apply + retire what's done
 *   node tools/apply-canonical-copy.mjs --dry-run  report only, touch nothing
 *   node tools/apply-canonical-copy.mjs --no-retire
 *
 * Exit 0 = every canonical row is satisfied in an upstream source.
 * Exit 1 = at least one row could not be placed. Loud on purpose: a silent
 *          no-op here is an edit that quietly disappears at the next ingest.
 *          (Estate rule, 2026-08-04: exit codes are not health — so this one
 *          is wired to mean something and prints a per-row verdict.)
 *
 * Reads canonical rows with the PUBLISHABLE key. `copy_overrides` RLS makes
 * canonical rows world-readable by design (they are the site's copy), so no
 * secret is needed to apply them. Retiring needs Mike's Supabase account token
 * from the macOS Keychain; without it the tool applies and says retirement was
 * skipped rather than pretending.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const APP = 'mike-wolf-library';
const SUPABASE_URL = 'https://omfwcodoimjmbrhssvfl.supabase.co';
const ANON_KEY = 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf';
const PROJECT_REF = 'omfwcodoimjmbrhssvfl';

const ROOT = new URL('..', import.meta.url).pathname;
const HOME = process.env.HOME;
const LEXICON = join(HOME, 'Projects/soma-lexicon/SOMA-LEXICON.md');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_RETIRE = argv.includes('--no-retire');

/* ── file classes ───────────────────────────────────────────────────────────
 * UPSTREAM = a file a human (or ingest) treats as the source of truth.
 *            Satisfying one of these is what makes a row retirable.
 * GENERATED = rebuilt by ingest. Patching it makes the site correct NOW, but
 *            it can never be the proof that the loop closed.               */
const upstreamFiles = () => {
  const out = [];
  if (existsSync(LEXICON)) out.push(LEXICON);
  const extra = join(ROOT, 'content-cache/terms-extra');
  if (existsSync(extra)) for (const f of readdirSync(extra)) if (f.endsWith('.md')) out.push(join(extra, f));
  out.push(join(ROOT, 'src/layouts/Base.astro'));
  for (const p of ['index', 'about/index', 'dictionary/index', 'corpus/index', 'atlas/index']) {
    out.push(join(ROOT, `src/pages/${p}.astro`));
  }
  return out.filter(existsSync);
};
const generatedFiles = () => {
  const dir = join(ROOT, 'src/content/terms');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
};

/* ── matching ───────────────────────────────────────────────────────────────
 * The key is the STRING, per the standard — never a selector. Two levels of
 * tolerance, tried in order:
 *   1. whitespace-flexible: the DOM collapses runs of whitespace, the source
 *      wraps sentences across lines.
 *   2. markdown-tolerant: SOMA-LEXICON.md is markdown, and mdBlockToHtml()
 *      strips ** and * on the way to HTML — so the sentence a human read has
 *      no emphasis markers in it and the source does.
 * Anything looser than this would start matching sentences nobody chose.   */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reWhitespace = (lit) => new RegExp(esc(lit).replace(/\s+/g, '\\s+'), 'g');
const reMarkdown = (lit) =>
  new RegExp(
    lit.trim().split(/\s+/).map((t) => `[*_\`]*${esc(t)}[*_\`]*`).join('[\\s*_]+'),
    'g'
  );

function findHits(text, literal) {
  let hits = [...text.matchAll(reWhitespace(literal))];
  if (hits.length) return { hits, mode: 'exact' };
  hits = [...text.matchAll(reMarkdown(literal))];
  return { hits, mode: hits.length ? 'markdown' : 'none' };
}

/** {status:'patched'|'already'|'none'|'ambiguous', text} */
function patch(text, row) {
  const { hits } = findHits(text, row.original_text);
  if (!hits.length) {
    const already = findHits(text, row.new_text).hits.length > 0;
    return { status: already ? 'already' : 'none', text };
  }
  let hit;
  if (hits.length === 1) hit = hits[0];
  else if ((row.occurrence || 0) < hits.length) hit = hits[row.occurrence || 0];
  else return { status: 'ambiguous', text };
  return {
    status: 'patched',
    text: text.slice(0, hit.index) + row.new_text + text.slice(hit.index + hit[0].length),
  };
}

/* ── data ───────────────────────────────────────────────────────────────── */
async function canonicalRows() {
  const url =
    `${SUPABASE_URL}/rest/v1/copy_overrides` +
    `?app=eq.${APP}&status=eq.canonical` +
    `&select=id,route,original_text,new_text,occurrence,note,status`;
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

/* ── main ───────────────────────────────────────────────────────────────── */
const rows = await canonicalRows();
if (!rows.length) {
  console.log('copy:apply — no canonical overrides. Nothing to write back.');
  process.exit(0);
}

console.log(`copy:apply — ${rows.length} canonical override(s) for ${APP}${DRY ? '  [dry-run]' : ''}`);

const ups = upstreamFiles();
const gens = generatedFiles();
const edits = new Map();          // path -> text
const retirable = [];
let failed = 0;

const load = (p) => (edits.has(p) ? edits.get(p) : readFileSync(p, 'utf8'));

for (const row of rows) {
  const slug = (row.note || '').startsWith('term:') ? row.note.slice(5) : null;
  // The slug is a HINT that narrows the search, never the match key. If it is
  // wrong or missing we search everything and rely on the string.
  const narrow = (list) => {
    if (!slug) return list;
    const preferred = list.filter((p) => p.endsWith(`/${slug}.md`) || p === LEXICON);
    return preferred.length ? preferred : list;
  };

  let upstreamHit = null;
  const touched = [];

  for (const p of narrow(ups)) {
    const r = patch(load(p), row);
    if (r.status === 'patched') { edits.set(p, r.text); touched.push(p); upstreamHit = p; break; }
    if (r.status === 'already') { upstreamHit = p; break; }
    if (r.status === 'ambiguous') { console.log(`   ! ambiguous in ${p.replace(ROOT, '')}`); }
  }

  // Generated layer: keeps the site correct between now and the next ingest.
  // Never counts as closure.
  for (const p of narrow(gens)) {
    const r = patch(load(p), row);
    if (r.status === 'patched') { edits.set(p, r.text); touched.push(p); break; }
    if (r.status === 'already') break;
  }

  const short = row.original_text.replace(/\s+/g, ' ').slice(0, 54);
  if (upstreamHit) {
    retirable.push(row.id);
    console.log(`   ✓ "${short}…"`);
    console.log(`     upstream: ${upstreamHit.replace(ROOT, '').replace(HOME, '~')}` +
      (touched.length ? `   patched: ${touched.map((p) => p.replace(ROOT, '')).join(', ')}` : '   (already said it)'));
  } else {
    failed++;
    console.log(`   ✗ "${short}…"  NO UPSTREAM SOURCE FOUND on ${row.route}`);
    console.log(`     searched ${ups.length} upstream files. This edit WILL be reverted by ingest.`);
  }
}

if (!DRY) {
  for (const [p, text] of edits) writeFileSync(p, text);
  console.log(`\nwrote ${edits.size} file(s)`);

  if (retirable.length && !NO_RETIRE) {
    const tok = keychainToken();
    if (tok) {
      retire(retirable, tok);
      console.log(`retired ${retirable.length} override(s) — the source now says it, so the row is history (§17a R4: never promotable again)`);
    } else {
      console.log(`NOT retired (${retirable.length}) — no Supabase token in Keychain. Sources are patched; rows stay canonical.`);
    }
  }
} else {
  console.log(`\n[dry-run] would write ${edits.size} file(s), retire ${retirable.length}`);
}

if (failed) {
  console.error(`\ncopy:apply FAILED — ${failed} override(s) have no upstream home.`);
  process.exit(1);
}
console.log('copy:apply OK — every canonical override is in an upstream source.');
