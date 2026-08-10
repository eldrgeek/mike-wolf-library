/* copy-canonize — SOMA §17 Tier 1 publish, with the loop actually closed.
 *
 * ── The wrinkle this function exists to solve ────────────────────────────────
 *
 * The Library's dictionary is GENERATED. `scripts/ingest.mjs` builds
 * `src/content/terms/*.md` from two upstream sources:
 *
 *   1. content-cache/terms-extra/<slug>.md   (in THIS repo — 395 terms)
 *   2. ~/Projects/soma-lexicon/SOMA-LEXICON.md (a DIFFERENT repo — ~62 terms)
 *
 * If "Make canonical" only stored a database override, the next `npm run
 * ingest` would silently revert Mike's edit and the site would have two
 * sources of truth — the exact failure SOMA/standards/soma-live-edit forbids.
 * If it only patched the generated file, `npm run ingest` would still revert
 * it. Closure therefore requires patching the UPSTREAM file, and the generated
 * file alongside it so the change ships now instead of at the next ingest.
 *
 * So canonize does a literal string swap — the same swap a build worker would
 * do, on exactly the key the standard mandates, (route, original_text,
 * occurrence) — directly against the repo via the GitHub Git Data API, in ONE
 * commit covering both layers. GitHub → Netlify auto-deploy → a logged-out
 * visitor reads the new words out of static HTML. No override is served at
 * runtime and the public read path stays $0/query.
 *
 * What this function CANNOT reach is SOMA-LEXICON.md, which lives in another
 * repo. Those rows come back `committed:false, reason:'upstream-out-of-repo'`
 * and are closed by `tools/apply-canonical-copy.mjs`, which runs as the first
 * step of `npm run ingest` — so ingest patches the lexicon before it
 * regenerates, and can never revert an edit. See that file's header.
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * The caller's Supabase JWT is passed straight through to `is_app_admin(app)`
 * — the same question RLS asks. No email allow-list, here or in the client.
 */

const APP = 'mike-wolf-library';
const SUPABASE_URL = 'https://omfwcodoimjmbrhssvfl.supabase.co';
const ANON_KEY = 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf';
const REPO = process.env.GITHUB_REPO || 'eldrgeek/mike-wolf-library';
const BRANCH = process.env.GITHUB_BRANCH || 'master';
const GH = 'https://api.github.com';

// Site copy that is not generated: searched when the edit did not happen
// inside a dictionary entry. Small, fixed list — a handful of blob fetches.
const SITE_COPY_FILES = [
  'src/layouts/Base.astro',
  'src/pages/index.astro',
  'src/pages/about/index.astro',
  'src/pages/dictionary/index.astro',
  'src/pages/corpus/index.astro',
  'src/pages/atlas/index.astro',
];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/* Whitespace-flexible literal match. The DOM collapses runs of whitespace; the
 * source file may wrap the same sentence across lines. Matching on the exact
 * bytes would fail on every wrapped paragraph, which is most of them. */
function flexible(literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s+'), 'g');
}

/* Returns {changed:boolean, text:string, reason?:string}. Idempotent: a file
 * that already says new_text and no longer says original_text is "done", not
 * "failed" — re-running canonize must never double-apply or error. */
function patch(text, originalText, newText, occurrence) {
  const re = flexible(originalText);
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) {
    const already = [...text.matchAll(flexible(newText))].length > 0;
    return { changed: false, text, reason: already ? 'already-applied' : 'no-match' };
  }
  // One hit is the common case. More than one and we honour the occurrence
  // index rather than guessing — and refuse if it is out of range, because
  // patching the wrong sentence is worse than patching none.
  let hit;
  if (hits.length === 1) hit = hits[0];
  else if (occurrence < hits.length) hit = hits[occurrence];
  else return { changed: false, text, reason: `ambiguous:${hits.length}-matches` };

  const out = text.slice(0, hit.index) + newText + text.slice(hit.index + hit[0].length);
  return { changed: true, text: out };
}

async function gh(token, path, init = {}) {
  const res = await fetch(GH + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'soma-live-edit',
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`github ${init.method || 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

async function readFile(token, path) {
  try {
    const r = await gh(token, `/repos/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`);
    return Buffer.from(r.content, 'base64').toString('utf8');
  } catch (e) {
    if (String(e.message).includes('-> 404')) return null;
    throw e;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json(401, { ok: false, error: 'no bearer token' });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'bad json' }); }
  const id = body && body.id;
  if (!id) return json(400, { ok: false, error: 'missing id' });

  const sb = (path, init = {}) =>
    fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });

  // ── admin gate: ask the DB the same question RLS asks ────────────────────
  const adminRes = await sb('/rest/v1/rpc/is_app_admin', {
    method: 'POST',
    body: JSON.stringify({ target_app: APP }),
  });
  const isAdmin = adminRes.ok && (await adminRes.json()) === true;
  if (!isAdmin) return json(403, { ok: false, error: 'not an admin for ' + APP });

  // ── load the row ─────────────────────────────────────────────────────────
  const rowRes = await sb(`/rest/v1/copy_overrides?id=eq.${encodeURIComponent(id)}&select=*`);
  const rows = rowRes.ok ? await rowRes.json() : [];
  const row = rows[0];
  if (!row) return json(404, { ok: false, error: 'row not found' });
  if (row.app !== APP) return json(400, { ok: false, error: 'wrong app' });
  // §17a R4 — a retired override is never revisable back into service.
  if (row.status === 'retired') return json(409, { ok: false, error: 'retired rows are not promotable' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json(500, { ok: false, error: 'GITHUB_TOKEN not configured' });

  // ── which files could hold this string? ──────────────────────────────────
  // note carries the term slug the client saw ("term:<slug>"). A HINT, never
  // the match key — if it is wrong we simply find nothing and say so.
  const slug = (row.note || '').startsWith('term:') ? row.note.slice(5) : null;
  const candidates = slug
    ? [`content-cache/terms-extra/${slug}.md`, `src/content/terms/${slug}.md`]
    : SITE_COPY_FILES.slice();

  const changes = [];
  const skipped = [];
  let sawUpstream = false;
  let sawGenerated = false;

  for (const path of candidates) {
    const text = await readFile(token, path);
    if (text === null) { skipped.push(`${path}:absent`); continue; }
    const r = patch(text, row.original_text, row.new_text, row.occurrence || 0);
    if (!r.changed) { skipped.push(`${path}:${r.reason}`);
      if (r.reason === 'already-applied') {
        if (path.startsWith('content-cache/')) sawUpstream = true;
        if (path.startsWith('src/content/')) sawGenerated = true;
      }
      continue;
    }
    changes.push({ path, content: r.text });
    if (path.startsWith('content-cache/')) sawUpstream = true;
    if (path.startsWith('src/content/')) sawGenerated = true;
  }

  // A term whose generated file matched but whose upstream did not is a
  // LEXICON term: its source is ~/Projects/soma-lexicon/SOMA-LEXICON.md, in
  // another repo. Say so precisely — the local tool closes it, and `npm run
  // ingest` runs that tool first, so nothing can revert.
  const reason = changes.length === 0
    ? (skipped.join(', ') || 'no candidate files')
    : (sawGenerated && !sawUpstream ? 'upstream-out-of-repo:soma-lexicon' : null);

  let sha = null;
  if (changes.length) {
    const ref = await gh(token, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const baseSha = ref.object.sha;
    const baseCommit = await gh(token, `/repos/${REPO}/git/commits/${baseSha}`);

    const tree = [];
    for (const c of changes) {
      const blob = await gh(token, `/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: c.content, encoding: 'utf-8' }),
      });
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh(token, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });
    const short = row.new_text.replace(/\s+/g, ' ').slice(0, 60);
    const commit = await gh(token, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message:
          `copy(live-edit): ${slug ? slug + ' — ' : ''}"${short}"\n\n` +
          `SOMA §17 in-place edit made canonical on ${row.route}.\n` +
          `was: ${row.original_text.replace(/\s+/g, ' ').slice(0, 200)}\n` +
          `now: ${row.new_text.replace(/\s+/g, ' ').slice(0, 200)}\n` +
          `override: ${row.id}\n` +
          (reason ? `note: ${reason}\n` : ''),
        tree: newTree.sha,
        parents: [baseSha],
      }),
    });
    await gh(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
    sha = commit.sha;
  }

  // ── mark the row canonical ───────────────────────────────────────────────
  // It stays canonical (not retired) until a local run of
  // tools/apply-canonical-copy.mjs has READ the source and confirmed it truly
  // says this. "Retired" means the source has caught up; nothing else may
  // claim that on the source's behalf.
  const patchRow = {
    status: 'canonical',
    canonical_at: new Date().toISOString(),
    note: sha ? `commit:${sha}${reason ? ' ' + reason : ''}` : `pending:${reason}`,
  };
  await sb(`/rest/v1/copy_overrides?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(patchRow),
  });

  return json(200, {
    ok: true,
    committed: Boolean(sha),
    sha,
    files: changes.map((c) => c.path),
    skipped,
    reason,
  });
};

// Functions 2.0 path routing. This is also why the endpoint survives
// netlify.toml's catch-all `/* -> /index.html 200`: function paths are matched
// before redirects, so /api/copy-canonize is never swallowed.
export const config = { path: '/api/copy-canonize' };
