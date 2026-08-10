/* soma-live-edit — Tier 1 (static), vanilla.
 *
 * SOMA App Standard §17 (admin edits copy in place) + §17a (the reviewer gets
 * three answers: take it, drop it, revise it).
 *
 * Ported from a-different-mind/js/live-edit.js, which is the working precedent
 * on a plain static site. Two decisions inherited from
 * SOMA/standards/soma-live-edit/README.md and deliberately not relitigated:
 *
 *   1. Match by STRING, never by DOM selector. The key is
 *      (app, route, original_text, occurrence). `main > div:nth-child(3)` dies
 *      at the next refactor; the sentence a human read does not — and the
 *      sentence is exactly what a build worker greps for.
 *   2. Re-apply on every DOM mutation. The dictionary filters/rehydrates its
 *      list client-side, so an override that applies once is an override that
 *      vanishes.
 *
 * ── WHAT IS DIFFERENT HERE, AND WHY (read this before changing anything) ────
 *
 * This is TIER 1, not Tier 2. The Library is a fully static, $0/query public
 * archive. On a-different-mind (Tier 2) every visitor's browser queries
 * `copy_overrides` on load and canonical rows are applied client-side. Here
 * that is forbidden: an anonymous visitor must make ZERO extra requests.
 *
 * So canonical copy is NOT served from the database. `Make canonical` writes
 * the new wording back into the SOURCE FILE in the repo, GitHub auto-deploys,
 * and a logged-out visitor reads the new words out of static HTML — the way
 * the standard describes Tier 1: "the change ships when the fleet applies it."
 *
 * The library's dictionary content is GENERATED (scripts/ingest.mjs builds
 * src/content/terms/*.md from ~/Projects/soma-lexicon/SOMA-LEXICON.md and
 * content-cache/terms-extra/). Patching only the generated file would be
 * reverted by the next `npm run ingest`. So canonize patches the UPSTREAM
 * source too — see netlify/functions/copy-canonize.mjs and
 * tools/apply-canonical-copy.mjs.
 *
 * Drafts still live in `copy_overrides` (admin-only under RLS) so the §17a
 * review surface has something to review. Only admins ever read that table.
 */
(function (global) {
  'use strict';

  /* ── per-site configuration ───────────────────────────────────────────────
   * Everything site-specific lives in window.SOMA_LIVE_EDIT, set by the page,
   * so THIS FILE IS BYTE-IDENTICAL across every site that adopts it. The
   * standard's README is blunt about why that matters: a vendored second copy
   * "starts rotting the same afternoon", and it names gdocs-addon re-
   * implementing four src/lib recognizers as the house example. Two static
   * sites adopting §17 on the same day is exactly how that starts. Diff the
   * two files; if they differ, one of them is wrong.
   *
   * The route -> source-file mapping is deliberately NOT here: it belongs to
   * the canonize function, which is per-site by nature.                       */
  var CFG = global.SOMA_LIVE_EDIT || {};
  var APP = CFG.app || 'unknown-app';
  var API = CFG.api || '/api/copy-canonize';

  /* Never touch. Two classes of thing:
   *   - anything a person other than the site owner wrote, or that the site
   *     did not author as COPY. On the Library that is the ARCHIVE: 759
   *     imported 70YearsWTF/Substack posts and the SRMW book are PUBLISHED
   *     ORIGINALS, and canonizing an edit to one would silently fork the
   *     archive from what Mike actually published. This is the safety
   *     property that outranks the feature (standard, §"safety").
   *   - controls, code, and the edit tooling's own chrome.
   * Opt-OUT, not opt-in: sites mark their untouchables with
   * [data-user-content] and may add selectors via SOMA_LIVE_EDIT.skip.        */
  var SKIP_SELECTOR = [
    '[data-user-content]', '[data-no-edit]',
    'textarea', 'input', 'select', 'option', 'button',
    'script', 'style', 'noscript', 'code', 'pre', 'svg',
    '#le-panel', '#le-bar', '#le-toast', '#le-auth'
  ].concat(CFG.skip || []).join(',');

  var drafts = [];       // admin-only review set (draft + canonical)
  var preview = [];      // rows applied locally so the admin can SEE the edit
  var isAdmin = false;
  var editing = false;
  var applied = new WeakMap();   // textNode -> original string, so we can revert

  function client() {
    return global.SomaAuth && global.SomaAuth.getClient
      ? global.SomaAuth.getClient() : null;
  }

  /* The path this copy is mounted at, from this script's own url. The Library
   * is served at library.mike-wolf.com today, but the estate has a habit of
   * re-mounting apps under a path on minds-aligned.org, and pathname lies at a
   * slashless route. Derive from the script src, which is always correct. */
  var BASE_PATH = (function () {
    var me = document.currentScript;
    if (!me) {
      var all = document.getElementsByTagName('script');
      me = all[all.length - 1];
    }
    if (!me || !me.src) return '/';
    try {
      return new URL(me.src).pathname.replace(/js\/live-edit\.js(\?.*)?$/, '');
    } catch (e) { return '/'; }
  })();

  /* Route normalization. Two jobs:
   *   1. the mount point is stripped, so the same page keyed the same way no
   *      matter which origin serves it.
   *   2. trailing slash is normalized. Astro emits directory-style URLs
   *      (/dictionary/), but a visitor can arrive at /dictionary — same page,
   *      and it must be the same key or the edit silently fails to appear.
   *
   * Deliberately NOT collapsing numeric segments to :id here (a-different-mind
   * does): the corpus slugs are words, and a term like "100-recycled-words"
   * must not be mangled into a route it does not have.
   */
  function route() {
    var p = location.pathname || '/';
    if (BASE_PATH !== '/' && p.indexOf(BASE_PATH) === 0) {
      p = '/' + p.slice(BASE_PATH.length);
    }
    p = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.length > 1 && p.charAt(p.length - 1) !== '/') p += '/';
    return p || '/';
  }

  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  /* Walk every editable text node in document order. Returns
   * [{node, text, occurrence}] where occurrence is the Nth identical string. */
  function walk() {
    var out = [];
    var counts = Object.create(null);
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!norm(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        var el = n.parentElement;
        if (!el || el.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) {
      // The original is whatever we first saw here — not the current value,
      // which may already carry a preview. `applied` holds the RAW nodeValue
      // (whitespace and all) so revert is byte-exact; matching uses norm().
      var text = applied.has(n) ? norm(applied.get(n)) : norm(n.nodeValue);
      var k = counts[text] || 0;
      counts[text] = k + 1;
      out.push({ node: n, text: text, occurrence: k });
    }
    return out;
  }

  function apply() {
    // Drafts are an ADMIN PREVIEW, not the site's copy — they belong to edit
    // mode. With this gate, "edit mode off" shows byte-for-byte what a visitor
    // sees, so the toggle genuinely doubles as before/after (ADOPT.md step 7).
    // Without it, revertAll() mutates the DOM, the MutationObserver wakes, and
    // apply() puts the draft straight back — the toggle looks broken. Caught
    // by clicking, not by reading: it needs the observer to be live.
    if (!editing) return;
    if (!preview.length) return;
    var r = route();
    var nodes = walk();
    for (var i = 0; i < nodes.length; i++) {
      var item = nodes[i];
      // Never stomp the node someone is currently typing into. The wrap span
      // fires mutations of its own, so without this the applier races the
      // human and the caret jumps.
      if (item.node.parentElement && item.node.parentElement.closest('[data-le-editing]')) continue;
      for (var j = 0; j < preview.length; j++) {
        var o = preview[j];
        if (o.route !== r) continue;
        if (o.original_text !== item.text) continue;
        if ((o.occurrence || 0) !== item.occurrence) continue;
        if (norm(item.node.nodeValue) === norm(o.new_text)) break; // already applied
        var raw = applied.has(item.node) ? applied.get(item.node) : item.node.nodeValue;
        if (!applied.has(item.node)) applied.set(item.node, raw);
        // Keep the node's surrounding whitespace. A dictionary body is
        //   <p><strong>What we mean.</strong> Absolution twisted…</p>
        // and the editable node's leading space is what separates the two.
        // Writing the normalized string straight in renders
        // "What we mean.Absolution twisted…" — found on the live page, not in
        // a test, because it only shows up next to an inline sibling.
        item.node.nodeValue =
          (raw.match(/^\s*/) || [''])[0] + o.new_text + (raw.match(/\s*$/) || [''])[0];
        break;
      }
    }
  }

  /* Reverting has to be as explicit as applying — "stop applying" is not
   * "undo" (standard, §"two design decisions"). */
  function revertAll() {
    var nodes = walk();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i].node;
      if (applied.has(n)) { n.nodeValue = applied.get(n); applied['delete'](n); }
    }
  }

  var applyQueued = false;
  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    // setTimeout, NOT requestAnimationFrame. rAF is paused in a hidden or
    // background tab, so a page opened in one would fetch its overrides and
    // then never apply them until the tab was focused.
    setTimeout(function () {
      applyQueued = false;
      try { apply(); } catch (e) { /* never let an override break the page */ }
    }, 0);
  }

  /* sync() runs whenever the override SET changes. A data change fires no DOM
   * mutation, so the observer never wakes — the bug this feature hits once and
   * then forever, per ADOPT.md step 7. */
  function sync() {
    revertAll();
    if (editing) scheduleApply();
  }

  function loadDrafts() {
    var c = client();
    if (!c || !isAdmin) return Promise.resolve();
    return c.from('copy_overrides')
      .select('id,route,original_text,new_text,occurrence,status,created_at,created_by,note,element_tag')
      .eq('app', APP).in('status', ['draft', 'canonical'])
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (!res.error && res.data) {
          drafts = res.data;
          // Preview = drafts only. Canonical rows have already been written
          // back into the source, so the static page ALREADY says the new
          // words; applying them again would be a no-op at best and a
          // double-apply at worst.
          preview = drafts.filter(function (r) { return r.status === 'draft'; });
          sync();
        }
      });
  }

  /* ── admin gate ───────────────────────────────────────────────────────────
   * Ask the DB the same question RLS asks. Per ADOPT.md step 4: no client-side
   * email allow-list fallback — a UI that thinks you're an admin while RLS
   * disagrees just shows you an editor where every save fails.
   *
   * TRI-STATE, and that matters. The first version returned a boolean and
   * swallowed every failure with `.catch(function(){ return false; })`, which
   * made "the database says you are not an admin" and "the call never got
   * there" look identical on screen — so the only symptom of a broken auth
   * path was a sign-in box that would not go away. It took Mike hitting it to
   * find. Never collapse those two again.
   *
   * Returns 'yes' | 'no' | 'error'. Also 'anon': the RPC succeeded but there
   * was no session attached, so auth.uid() was NULL and the honest answer is
   * "nobody asked", not "no". */
  function checkAdmin() {
    var c = client();
    if (!c) return Promise.resolve({ state: 'error', why: 'no supabase client' });
    return c.auth.getSession().then(function (s) {
      var sess = s && s.data && s.data.session;
      if (!sess) return { state: 'anon', why: 'no session attached' };
      return c.rpc('is_app_admin', { target_app: APP }).then(function (res) {
        if (res.error) {
          return { state: 'error', why: res.error.message || 'rpc failed' };
        }
        return { state: res.data === true ? 'yes' : 'no', email: sess.user && sess.user.email };
      });
    })['catch'](function (e) {
      return { state: 'error', why: (e && e.message) || String(e) };
    });
  }

  /* ── which upstream file does this string live in? ────────────────────────
   * A hint, not a key. Every dictionary entry renders as
   * <article id="term-<slug>">, so an edit inside one can name the term whose
   * source file has to change. The canonize function uses this to go straight
   * to content-cache/terms-extra/<slug>.md instead of searching the tree; if
   * it is absent the function falls back to searching the site-copy files.
   * Nothing MATCHES on it. */
  function termHint(el) {
    if (!CFG.hintSelector || !el || !el.closest) return null;
    var a = el.closest(CFG.hintSelector);
    if (!a || !a.id) return null;
    var p = CFG.hintPrefix || '';
    return p && a.id.indexOf(p) === 0 ? a.id.slice(p.length) : a.id;
  }

  /* ── editing ──────────────────────────────────────────────────────────── */

  /* Edit ONE TEXT NODE, never a whole element.
   *
   * This is the difference between this port and the a-different-mind one, and
   * it is not cosmetic. Almost every dictionary entry renders as
   *
   *     <p><strong>What we mean.</strong> Absolution twisted to abolution…</p>
   *
   * Making the <p> contenteditable — what the precedent does — means the saved
   * `after` is el.textContent, i.e. "What we mean. Absolution twisted…", while
   * `before` is only the text node, "Absolution twisted…". The override then
   * replaces one node with both nodes' text and the page renders "What we
   * mean. What we mean. Absolution…". The standard names this case ("an
   * element whose content is more than one node… a structural edit cannot
   * honestly be expressed as a string swap") but prescribes a popover, which
   * on this site would mean a popover for essentially every entry.
   *
   * So: wrap the clicked text node in a throwaway span, edit that, unwrap. The
   * edited region is exactly the string that is the match key — before and
   * after are the same kind of thing — and typing still happens in place. */
  function startEdit(el, item) {
    if (el.isContentEditable) return;
    var before = item.text;
    var hint = termHint(el);
    var node = item.node;
    var rawBefore = node.nodeValue;   // whitespace included — see apply()

    var span = document.createElement('span');
    span.setAttribute('data-le-wrap', '1');
    span.setAttribute('data-le-editing', '1');
    node.parentNode.replaceChild(span, node);
    span.appendChild(node);
    span.contentEditable = 'true';
    span.focus();
    // Put the caret in the span rather than leaving it wherever the click
    // landed in the old node, which the DOM has just moved out from under it.
    try {
      var r = document.createRange(); r.selectNodeContents(span);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      sel.collapseToEnd();
    } catch (e) {}

    var done = false;
    function unwrap() {
      var parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    function finish(save) {
      if (done) return; done = true;
      span.contentEditable = 'false';
      span.removeEventListener('blur', onBlur);
      span.removeEventListener('keydown', onKey);
      var after = norm(span.textContent);
      if (!save || after === before || !after) { span.textContent = rawBefore; unwrap(); return; }
      // Put the ORIGINAL string back before saving, and let the applier put
      // the new one in. Otherwise the node's "original" identity silently
      // becomes the new text for the rest of this page load — the override
      // then matches nothing, revert has nothing to revert to, and toggling
      // edit mode off leaves the draft on screen looking published.
      span.textContent = rawBefore;
      unwrap();
      saveOverride(before, after, item.occurrence, el, hint);
    }
    function onBlur() { finish(true); }
    // One Enter convention across all three editors (in-place, review row,
    // and the sign-in field): Enter saves, Shift+Enter breaks the line.
    function onKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }
    span.addEventListener('blur', onBlur);
    span.addEventListener('keydown', onKey);
  }

  function saveOverride(original, next, occurrence, el, hint) {
    var c = client();
    if (!c) return;
    c.auth.getUser().then(function (u) {
      var uid = u && u.data && u.data.user ? u.data.user.id : null;
      // upsert on the unique key (app, route, original_text, occurrence):
      // re-editing the same string updates the row rather than stacking rows
      // that fight over the node.
      return c.from('copy_overrides').upsert({
        app: APP,
        route: route(),
        original_text: original,
        new_text: next,
        occurrence: occurrence || 0,
        element_path: hint ? ('article#term-' + hint) : null,
        element_tag: el ? el.tagName.toLowerCase() : null,
        page_title: document.title,
        sample_url: location.href,
        status: 'draft',
        note: hint ? ('term:' + hint) : null,
        created_by: uid
      }, { onConflict: 'app,route,original_text,occurrence' });
    }).then(function (res) {
      toast(res && res.error ? ('Save failed: ' + res.error.message) : 'Saved as draft');
      return loadDrafts().then(renderPanel);
    });
  }

  function onClick(e) {
    if (!editing) return;
    var el = e.target;
    if (!el || !el.closest) return;
    if (el.closest(SKIP_SELECTOR)) {
      // Say why, out loud. A surface that silently refuses to edit is how
      // somebody concludes the feature is broken.
      if (el.closest('[data-user-content]')) {
        toast(CFG.userContentMessage ||
          'Not editable — this text is not site copy.');
        e.preventDefault(); e.stopPropagation();
      }
      return;
    }
    var nodes = walk();
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].node.parentElement === el) {
        e.preventDefault();
        e.stopPropagation();
        startEdit(el, nodes[i]);
        return;
      }
    }
  }

  /* ── §17a review: three answers, not two ─────────────────────────────── */

  var myUid = null;

  // R4: retired is never promotable. (Retired rows are not even loaded into
  // the panel, and the function refuses them server-side as well.)
  function canonize(row) {
    if (row.status === 'retired') { toast('Retired rows are not promotable.'); return; }
    var c = client();
    if (!c) return;
    toast('Writing back to source…');
    c.auth.getSession().then(function (s) {
      var tok = s && s.data && s.data.session ? s.data.session.access_token : null;
      if (!tok) { toast('Sign in again — session expired.'); return null; }
      return fetch(API.charAt(0) === '/' ? BASE_PATH + API.slice(1) : API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ id: row.id })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
    }).then(function (out) {
      if (!out) return;
      if (!out.ok || !out.j.ok) { toast('Canonize failed: ' + (out.j && out.j.error || 'unknown')); return; }
      toast(out.j.committed
        ? ('Published — patched ' + out.j.files.length + ' source file(s), commit ' + out.j.sha.slice(0, 7) + '. Live in ~90s.')
        : ('Published, but no source file matched — run `npm run copy:apply` locally. (' + (out.j.reason || '') + ')'));
      return loadDrafts().then(renderPanel);
    })['catch'](function (e) { toast('Canonize failed: ' + e.message); });
  }

  function dropRow(row) {
    var c = client();
    if (!c) return;
    c.from('copy_overrides').delete().eq('id', row.id).then(function (res) {
      toast(res.error ? ('Failed: ' + res.error.message) : 'Dropped');
      return loadDrafts().then(renderPanel);
    });
  }

  // R1/R2: the reviewer can rewrite, and only new_text moves. The match key
  // (original_text, occurrence) is never offered as a field.
  function reviseRow(row, next) {
    var c = client();
    if (!c || !next || next === row.new_text) { toast('No change.'); return; }
    if (row.status === 'retired') { toast('Retired rows are not promotable.'); return; }
    c.from('copy_overrides').update({ new_text: next, updated_at: new Date().toISOString() })
      .eq('id', row.id).then(function (res) {
        if (res.error) { toast('Failed: ' + res.error.message); return; }
        // R3: revising live copy is a PUBLISH — it must re-file, not just save.
        if (row.status === 'canonical') { row.new_text = next; canonize(row); return; }
        toast('Revised');
        return loadDrafts().then(renderPanel);
      });
  }

  /* ── chrome ───────────────────────────────────────────────────────────── */

  function toast(msg) {
    var t = document.getElementById('le-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'le-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = ''; }, 4200);
  }

  function renderPanel() {
    var p = document.getElementById('le-panel');
    if (!p) return;
    p.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = 'Live edits';
    p.appendChild(h);

    if (!drafts.length) {
      var none = document.createElement('p');
      none.className = 'le-none';
      none.textContent = 'No edits yet. Turn on Edit copy, click any sentence, type, press Enter.';
      p.appendChild(none);
      return;
    }

    drafts.forEach(function (row) {
      var d = document.createElement('div');
      d.className = 'le-row le-' + row.status;

      var meta = document.createElement('div');
      meta.className = 'le-meta';
      // R5: authorship is visible. Everything an admin sees may be another
      // admin's draft — the RLS read policy is is_app_admin(app), not "mine".
      var mine = myUid && row.created_by === myUid;
      meta.textContent = row.status + ' · ' + row.route + ' · ' + (mine ? 'you' : 'another admin');
      d.appendChild(meta);

      var was = document.createElement('div');
      was.className = 'le-was';
      was.textContent = row.original_text;   // R2: shown, never editable
      d.appendChild(was);

      var now = document.createElement('textarea');
      now.className = 'le-now';
      now.value = row.new_text;
      now.rows = 2;
      now.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reviseRow(row, now.value.trim()); }
      });
      d.appendChild(now);

      var bar = document.createElement('div');
      bar.className = 'le-actions';

      // Three answers (§17a R1): take, revise, drop.
      if (row.status !== 'canonical') {
        var take = document.createElement('button');
        take.textContent = 'Make canonical';
        take.title = 'Write this into the source file and ship it to every visitor';
        take.onclick = function () { canonize(row); };
        bar.appendChild(take);
      }

      var rev = document.createElement('button');
      // R3: the label says it republishes. "Save" on live copy is a surprise.
      rev.textContent = row.status === 'canonical' ? 'Save & republish' : 'Revise';
      rev.onclick = function () { reviseRow(row, now.value.trim()); };
      bar.appendChild(rev);

      var drop = document.createElement('button');
      drop.className = 'le-drop';
      drop.textContent = 'Drop';
      drop.title = row.status === 'canonical'
        ? 'Removes the row. The source file already says this — reverting the words is a source edit.'
        : "Discard; the source's own wording returns";
      drop.onclick = function () { dropRow(row); };
      bar.appendChild(drop);

      d.appendChild(bar);

      if (row.note && /^commit:/.test(row.note)) {
        var n = document.createElement('div');
        n.className = 'le-note';
        n.textContent = row.note;
        d.appendChild(n);
      }

      p.appendChild(d);
    });
  }

  function mountBar() {
    if (document.getElementById('le-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'le-bar';

    var toggle = document.createElement('button');
    toggle.id = 'le-toggle';
    toggle.textContent = 'Edit copy';
    var review = document.createElement('button');
    review.id = 'le-review';
    review.textContent = 'Review';
    var out = document.createElement('button');
    out.id = 'le-out';
    out.className = 'le-quiet';
    out.textContent = 'Sign out';
    bar.appendChild(toggle); bar.appendChild(review); bar.appendChild(out);
    document.body.appendChild(bar);

    var panel = document.createElement('div');
    panel.id = 'le-panel';
    panel.hidden = true;
    document.body.appendChild(panel);

    toggle.onclick = function () {
      editing = !editing;
      this.classList.toggle('on', editing);
      document.body.classList.toggle('le-editing', editing);
      this.textContent = editing ? 'Editing — click a sentence' : 'Edit copy';
      // Edit mode off shows exactly what a visitor sees, so the toggle doubles
      // as before/after (ADOPT.md step 7).
      if (editing) { sync(); } else { revertAll(); }
    };
    review.onclick = function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) loadDrafts().then(renderPanel);
    };
    out.onclick = doSignOut;
    document.addEventListener('click', onClick, true);
  }

  /* ── sign-in ──────────────────────────────────────────────────────────────
   * Deliberately not on the page for readers. It appears only on the admin
   * path (?edit=1 / #edit, or a session already in this browser).
   *
   * ONLY EVER SHOWN WHEN THERE IS NO SESSION. Showing a sign-in prompt to
   * somebody who is already signed in is the trap door Mike fell through:
   * the only Sign out control lived on the admin pill, so a signed-in
   * non-admin got an editor-less page, a sign-in box, and no way out. */
  function mountAuth(notice) {
    var existing = document.getElementById('le-auth');
    if (existing) {
      if (notice) {
        var n = existing.querySelector('.le-notice');
        if (!n) { n = document.createElement('p'); n.className = 'le-notice'; existing.insertBefore(n, existing.children[2]); }
        n.textContent = notice;
      }
      return;
    }
    var box = document.createElement('div');
    box.id = 'le-auth';
    box.innerHTML =
      '<h3>Sign in to edit</h3>' +
      '<p>Admins only. Readers never need an account.</p>' +
      (notice ? '<p class="le-notice"></p>' : '') +
      '<input id="le-email" type="email" placeholder="you@example.com" autocomplete="email">' +
      '<button id="le-magic">Email me a link</button>' +
      '<button id="le-google" class="le-quiet">Continue with Google</button>' +
      '<button id="le-close" class="le-quiet">Not now</button>';
    document.body.appendChild(box);
    if (notice) box.querySelector('.le-notice').textContent = notice;

    // redirectTo MUST carry a path. Supabase's allow-list glob
    // https://library.mike-wolf.com/** does not match the bare origin with no
    // trailing slash — sign-in would bounce to Legends. Verified live.
    var back = location.origin + (location.pathname || '/') + '?edit=1';

    function send() {
      var email = document.getElementById('le-email').value.trim();
      if (!email) return;
      global.SomaAuth.signInWithOtp(email, {
        emailRedirectTo: back,
        data: { site_name: 'The Library' }
      }).then(function (r) {
        toast(r.error ? ('Failed: ' + r.error.message) : 'Check your email for the link.');
      });
    }
    document.getElementById('le-magic').onclick = send;
    document.getElementById('le-email').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('le-google').onclick = function () {
      global.SomaAuth.signInWithOAuth('google', { redirectTo: back });
    };
    document.getElementById('le-close').onclick = function () { box.remove(); };
  }

  /* ── signed in, but not an admin here ─────────────────────────────────────
   * The state that had no UI at all. Say who you are, say plainly that this
   * account has no admin role on this app, and give the way out. Same
   * reasoning as the archive-refusal toast: a surface that silently does the
   * wrong thing is how somebody concludes the feature is broken. */
  function mountNoAdmin(email, why) {
    var box = document.getElementById('le-noadmin');
    if (!box) {
      box = document.createElement('div');
      box.id = 'le-noadmin';
      document.body.appendChild(box);
    }
    box.innerHTML = '';
    var h = document.createElement('h3');
    h.textContent = why ? 'Could not check your access' : 'No editing access';
    box.appendChild(h);

    var who = document.createElement('p');
    who.className = 'le-who';
    who.textContent = 'Signed in as ' + (email || 'an unknown account') + '.';
    box.appendChild(who);

    var msg = document.createElement('p');
    msg.textContent = why
      // An error is NOT a "no". Say which one happened.
      ? 'The admin check did not complete: ' + why + '. This is not the same as being denied — the answer never arrived.'
      : 'This account has no admin role on ' + (CFG.appLabel || APP) + ', so in-place editing is off. Nothing else about the site is affected.';
    box.appendChild(msg);

    if (why) {
      var retry = document.createElement('button');
      retry.textContent = 'Try again';
      retry.onclick = function () { refreshAdmin(); };
      box.appendChild(retry);
    }

    var out = document.createElement('button');
    out.className = 'le-quiet';
    out.textContent = 'Sign out';
    out.onclick = doSignOut;
    box.appendChild(out);

    var close = document.createElement('button');
    close.className = 'le-quiet';
    close.textContent = 'Dismiss';
    close.onclick = function () { box.remove(); };
    box.appendChild(close);
  }

  /* One sign-out, reachable from every signed-in state — the pill, the
   * no-admin panel, the error panel, `?edit=out`, and SomaLiveEdit.signOut().
   * Clears the sticky admin-path flag too, or the next page load re-arms the
   * whole machine for somebody who just asked to leave. */
  function doSignOut() {
    try { localStorage.removeItem(CFG.stickyKey || 'mwl-live-edit'); } catch (e) {}
    var done = function () {
      // Strip auth params so a refresh cannot replay a consumed token.
      try {
        var u = new URL(location.href);
        u.hash = '';
        ['code', 'edit', 'error', 'error_description'].forEach(function (k) { u.searchParams['delete'](k); });
        location.replace(u.toString());
      } catch (e) { location.reload(); }
    };
    if (global.SomaAuth && global.SomaAuth.signOut) {
      global.SomaAuth.signOut().then(done)['catch'](done);
    } else { done(); }
  }

  /* SomaAuth.init() builds its Supabase client asynchronously, so calling
   * getClient() on the same tick returns null and every load below silently
   * no-ops — the failure mode is an override that exists in the database and
   * never appears on the page. Wait for the client instead of assuming it. */
  function whenClient(fn, tries) {
    tries = tries == null ? 100 : tries;   // ~5s at 50ms
    if (client()) return fn();
    if (tries <= 0) return;
    setTimeout(function () { whenClient(fn, tries - 1); }, 50);
  }

  /* ── the sign-in return ───────────────────────────────────────────────────
   *
   * THE BUG THIS EXISTS TO FIX, reproduced on prod 2026-08-10: Mike clicked a
   * magic link, landed on /dictionary/?edit=1#access_token=…, and was shown
   * "Sign in to edit". Eighteen seconds later the token was STILL sitting
   * unconsumed in the URL and there was no session.
   *
   * Cause: `soma-auth.js` sets `flowType: 'pkce'`, and supabase-js in PKCE
   * mode only ever looks for `?code=` — it ignores an implicit-grant
   * `#access_token=` fragment completely. Silently. No event, no error. If
   * the link that reaches the user was minted without a code_challenge (an
   * admin-generated link, a re-send, anything server-side) it comes back
   * implicit and `detectSessionInUrl` is a no-op.
   *
   * The sibling failure, same symptom: a PKCE `?code=` opened in a DIFFERENT
   * browser from the one that requested it — a link mailed to a laptop and
   * tapped on a phone. The code_verifier lives in the requesting browser's
   * storage, so the exchange cannot succeed, and supabase-js reports that by
   * doing nothing at all.
   *
   * So: do not trust detectSessionInUrl. Look at the URL, and if it carries
   * credentials that no session has appeared for, consume them here — and if
   * that fails, SAY SO, with the actual reason, on screen. */
  function urlAuth() {
    var out = { kind: null };
    var hash = (location.hash || '').replace(/^#/, '');
    var hq = new URLSearchParams(hash);
    var sq = new URLSearchParams(location.search || '');

    if (sq.get('error') || hq.get('error')) {
      out.kind = 'error';
      out.message = hq.get('error_description') || sq.get('error_description') ||
                    hq.get('error') || sq.get('error');
      return out;
    }
    if (hq.get('access_token')) {
      out.kind = 'implicit';
      out.access_token = hq.get('access_token');
      out.refresh_token = hq.get('refresh_token');
      return out;
    }
    if (sq.get('code')) { out.kind = 'pkce'; out.code = sq.get('code'); return out; }
    return out;
  }

  function cleanUrl() {
    try {
      var u = new URL(location.href);
      u.hash = '';
      ['code', 'error', 'error_description'].forEach(function (k) { u.searchParams['delete'](k); });
      history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  /* Resolve the URL's credentials into a session. Returns a promise of
   * {ok:true} | {ok:false, message}. */
  function consumeUrlAuth(info) {
    var c = client();
    if (!c) return Promise.resolve({ ok: false, message: 'no supabase client' });

    if (info.kind === 'implicit') {
      return c.auth.setSession({
        access_token: info.access_token, refresh_token: info.refresh_token
      }).then(function (r) {
        if (r.error) return { ok: false, message: r.error.message };
        cleanUrl();
        return { ok: true };
      })['catch'](function (e) { return { ok: false, message: (e && e.message) || String(e) }; });
    }

    if (info.kind === 'pkce') {
      if (!c.auth.exchangeCodeForSession) {
        return Promise.resolve({ ok: false, message: 'this supabase build cannot exchange a code' });
      }
      return c.auth.exchangeCodeForSession(info.code).then(function (r) {
        if (r.error) {
          // Overwhelmingly the cross-device case. Say the useful thing rather
          // than the literal one ("invalid request: both auth code and code
          // verifier should be non-empty" helps nobody).
          var m = r.error.message || 'code exchange failed';
          if (/verifier/i.test(m)) {
            m = 'this sign-in link was opened in a different browser from the one that asked for it, so it cannot be completed here. Request a new link below, in THIS browser.';
          }
          return { ok: false, message: m };
        }
        cleanUrl();
        return { ok: true };
      })['catch'](function (e) { return { ok: false, message: (e && e.message) || String(e) }; });
    }

    return Promise.resolve({ ok: false, message: 'nothing to consume' });
  }

  var resolving = false;

  function refreshAdmin() {
    return checkAdmin().then(function (r) {
      var c = client();

      // ── signed in AND admin ────────────────────────────────────────────
      if (r.state === 'yes') {
        isAdmin = true;
        var a = document.getElementById('le-auth'); if (a) a.remove();
        var na = document.getElementById('le-noadmin'); if (na) na.remove();
        mountBar();
        if (c) c.auth.getUser().then(function (u) {
          myUid = u && u.data && u.data.user ? u.data.user.id : null;
        });
        return loadDrafts().then(renderPanel);
      }

      isAdmin = false;
      var bar = document.getElementById('le-bar'); if (bar) bar.remove();

      // ── signed in, NOT an admin ───────────────────────────────────────
      // Never a sign-in prompt. Identity + a working way out.
      if (r.state === 'no') {
        var b1 = document.getElementById('le-auth'); if (b1) b1.remove();
        mountNoAdmin(r.email, null);
        return;
      }

      // ── the check itself failed ───────────────────────────────────────
      // Distinct from "no", and it says so.
      if (r.state === 'error') {
        var b2 = document.getElementById('le-auth'); if (b2) b2.remove();
        return (c ? c.auth.getSession() : Promise.resolve(null)).then(function (s) {
          var sess = s && s.data && s.data.session;
          if (sess) { mountNoAdmin(sess.user && sess.user.email, r.why); }
          else { mountAuth('The admin check failed: ' + r.why); }
        });
      }

      // ── no session ────────────────────────────────────────────────────
      // Before concluding "signed out", see whether the URL is carrying
      // credentials nobody has consumed. This is the whole bug.
      var info = urlAuth();

      if (info.kind === 'error') {
        mountAuth('Sign-in failed: ' + info.message);
        return;
      }
      if ((info.kind === 'implicit' || info.kind === 'pkce') && !resolving) {
        resolving = true;
        mountPending();
        // Give supabase-js its own chance first — if detectSessionInUrl works
        // (the normal PKCE, same-browser case) we must not race it and burn
        // the code with a second exchange.
        return waitForSession(2500).then(function (got) {
          if (got) { resolving = false; cleanUrl(); return refreshAdmin(); }
          return consumeUrlAuth(info).then(function (res) {
            resolving = false;
            var p = document.getElementById('le-pending'); if (p) p.remove();
            if (res.ok) return refreshAdmin();
            mountAuth('Could not finish signing you in — ' + res.message);
          });
        });
      }

      var p = document.getElementById('le-pending'); if (p) p.remove();
      mountAuth();
    });
  }

  function waitForSession(ms) {
    var c = client();
    if (!c) return Promise.resolve(false);
    var deadline = Date.now() + ms;
    return new Promise(function (resolve) {
      (function poll() {
        c.auth.getSession().then(function (s) {
          if (s && s.data && s.data.session) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(poll, 150);
        })['catch'](function () { resolve(false); });
      })();
    });
  }

  function mountPending() {
    if (document.getElementById('le-pending')) return;
    var d = document.createElement('div');
    d.id = 'le-pending';
    d.textContent = 'Finishing sign-in…';
    document.body.appendChild(d);
  }

  function init() {
    new MutationObserver(scheduleApply)
      .observe(document.body, { childList: true, subtree: true, characterData: true });

    /* Order matters and cost me a deadlock the first time: SomaAuth.getClient()
     * returns null until init() has run, so waiting for the client BEFORE
     * calling init() waits forever. On a-different-mind app.js happens to call
     * init() and live-edit.js only waits; here live-edit IS the only consumer,
     * so it has to start the thing it is waiting for.
     *
     * onAuthStateChange must be registered BEFORE init() or INITIAL_SESSION —
     * the event that fires for an already-signed-in admin arriving on a cold
     * page load — is missed entirely. SomaAuth documents this at :305. */
    global.SomaAuth.onAuthStateChange(function (evt) {
      // Don't re-enter while we are mid-exchange; refreshAdmin() calls itself
      // once the session lands.
      if (resolving && evt !== 'SIGNED_IN') return;
      refreshAdmin();
    });
    global.SomaAuth.init();

    whenClient(function () {
      // Escape hatch, reachable without any UI: ?edit=out signs you out and
      // clears the sticky flag. For anyone already stranded by the trap door
      // that shipped this morning — and for whatever strands someone next.
      if (/[?#&]edit=out\b/.test(location.search + location.hash)) {
        return doSignOut();
      }
      // Admin state follows auth continuously, never a boot-time snapshot
      // (ADOPT.md step 7) — a magic-link return fires SIGNED_IN after boot.
      refreshAdmin();
    });
  }

  global.SomaLiveEdit = {
    init: init, apply: apply, revertAll: revertAll, sync: sync,
    route: route, _walk: walk, _skip: SKIP_SELECTOR,
    // Always callable, in any state, from the console — the last resort that
    // does not depend on any panel having rendered.
    signOut: doSignOut,
    whoami: function () {
      var c = client();
      if (!c) return Promise.resolve({ session: false, reason: 'no client' });
      return c.auth.getSession().then(function (s) {
        var sess = s && s.data && s.data.session;
        return checkAdmin().then(function (r) {
          return { session: !!sess, email: sess && sess.user && sess.user.email,
                   app: APP, admin: r.state, why: r.why || null };
        });
      });
    }
  };
})(window);
