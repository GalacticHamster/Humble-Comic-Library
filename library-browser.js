// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
// Read-only presentation model for the Options library browser. Builds "Bundles & Orders"
// groups from historical purchases and, when the native collector is enabled, from the
// active account's native Library observations. Nothing here writes storage. Groups are
// keyed by order key or native parent ID and are never merged by name.
(function initLibraryBrowser(global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const HUMBLE = 'https://www.humblebundle.com';
  // Route templates from Humble's own route manifest, checked against the signed-in
  // account: a purchase (bundle, store or widget) and one entitlement inside it. Both
  // take native IDs. Historical order keys have no verified page: the old downloads
  // link now redirects to the generic Library.
  const purchaseRoute = id => typeof id === 'string' && UUID.test(id) ? HUMBLE + '/home/library/' + id : null;
  const entitlementRoute = id => typeof id === 'string' && UUID.test(id) ? HUMBLE + '/home/library/content/' + id : null;
  const CATEGORIES = { book: 'book', comic: 'book', game: 'game', software: 'software', audiobook: 'audiobook', video: 'video' };
  const category = kind => CATEGORIES[String(kind || '').toLowerCase()] || 'unknown';
  const lower = v => String(v ?? '').toLowerCase();
  const time = v => { const t = typeof v === 'string' || typeof v === 'number' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const NATIVE_TYPES = { bundle: 'bundle', storefront: 'store', widget: 'widget' };

  function recordsOf(item) {
    if (Array.isArray(item.provenance) && item.provenance.length) {
      return item.provenance.filter(p => p && typeof p === 'object').map(p => ({ purchaseKey: p.purchaseKey || '', sourceBundle: p.sourceBundle || '', purchasedAt: p.purchasedAt || null }));
    }
    return item.purchaseKey || item.sourceBundle || item.bundle?.title
      ? [{ purchaseKey: item.purchaseKey || '', sourceBundle: item.sourceBundle || item.bundle?.title || '', purchasedAt: item.purchasedAt || null }] : [];
  }

  const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  // Derived search and filter fields. A title seen under two spellings is searchable by both.
  function finishGroup(g) {
    g.nameLower = lower(g.name) + (g.historicalName ? '\n' + lower(g.historicalName) : '');
    g.titlesLower = g.items.map(i => lower(i.title) + (i.historicalTitle ? '\n' + lower(i.historicalTitle) : ''));
    g.categories = {};
    for (const i of g.items) g.categories[i.category] = (g.categories[i.category] ?? 0) + 1;
    const known = Object.keys(g.categories).filter(c => c !== 'unknown');
    g.media = known.length > 1 ? 'mixed' : known[0] ?? 'unknown';
    g.excluded = g.items.filter(i => i.excluded).length;
  }

  function group(key, fields) {
    return { key, name: null, type: 'unknown', purchasedAt: null, listedCount: null, orderRecorded: false, parentId: null, route: null, items: [], ...fields };
  }

  // Native groups need an enabled collector and the active account's own scope.
  function nativeScope({ libraryEntitlements, humbleAccountId, entitlements }) {
    if (!entitlements?.ENABLED || !libraryEntitlements || typeof humbleAccountId !== 'string') return { scope: null, error: false };
    try {
      const scopes = entitlements.collection(libraryEntitlements).scopes;
      return { scope: scopes.find(s => s.localAccountId !== null && s.localAccountId === humbleAccountId) ?? null, error: false };
    } catch { return { scope: null, error: true }; }
  }

  function buildGroups({ items = [], purchaseSummaries = [], libraryEntitlements = null, humbleAccountId = null, entitlements = global.HumbleLibraryEntitlements } = {}) {
    const groups = new Map();
    const summaries = new Map((Array.isArray(purchaseSummaries) ? purchaseSummaries : []).filter(p => p && typeof p.purchaseKey === 'string' && p.purchaseKey).map(p => [p.purchaseKey, p]));
    const historical = (purchaseKey, sourceBundle) => {
      // Without an order key the name is the only grouping evidence; such groups say so.
      const key = purchaseKey ? 'h:' + purchaseKey : 'hn:' + lower(sourceBundle).trim();
      if (!groups.has(key)) {
        const s = summaries.get(purchaseKey);
        groups.set(key, group(key, { source: 'historical', name: (s?.sourceBundle || sourceBundle || '').trim() || null, purchasedAt: time(s?.purchasedAt),
          listedCount: Number.isInteger(s?.itemCount) ? s.itemCount : null, orderRecorded: Boolean(purchaseKey) }));
      }
      return groups.get(key);
    };
    for (const summary of summaries.values()) historical(summary.purchaseKey, summary.sourceBundle);
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      const joined = new Set();
      for (const rec of recordsOf(item)) {
        if (!rec.purchaseKey && !String(rec.sourceBundle).trim()) continue;
        const g = historical(rec.purchaseKey, rec.sourceBundle);
        if (joined.has(g)) continue;
        joined.add(g); g.purchasedAt ??= time(rec.purchasedAt);
        g.items.push({ title: String(item.title || ''), kind: item.kind || item.mediaType || 'unclassified', category: category(item.kind || item.mediaType), source: 'historical', status: 'purchased', excluded: false, route: null });
      }
    }
    const native = nativeScope({ libraryEntitlements, humbleAccountId, entitlements });
    // The same media resolution the bundle matcher uses: provider evidence, then agreeing imported records.
    const kinds = native.scope && entitlements.historicalKinds ? entitlements.historicalKinds(Array.isArray(items) ? items : []) : null;
    for (const r of native.scope?.observations ?? []) {
      const media = kinds ? entitlements.resolvedMedia(r, kinds) : r.mediaType;
      const key = 'n:' + r.parentId;
      if (!groups.has(key)) groups.set(key, group(key, { source: 'native', parentId: r.parentId, type: NATIVE_TYPES[r.eligibility?.parentType] ?? 'unknown', route: purchaseRoute(r.parentId) }));
      const g = groups.get(key);
      if (!g.name && r.parentTitle) g.name = r.parentTitle;
      g.items.push({ title: r.title, kind: media, category: category(media), source: 'native', status: r.purchaseStatus, excluded: r.purchaseStatus !== 'purchased',
        gifted: r.eligibility?.giftStatus === 'gifted', namespace: r.namespace, activation: r.activationStatus, nativeId: r.nativeId, route: entitlementRoute(r.nativeId) });
    }
    const list = [...groups.values()];
    const names = new Map();
    for (const g of list) {
      g.items.sort((a, b) => COLLATOR.compare(a.title, b.title));
      finishGroup(g);
      if (g.name) { const k = g.nameLower.trim(); if (!names.has(k)) names.set(k, { historical: 0, native: 0 }); names.get(k)[g.source]++; }
    }
    for (const g of list) {
      const n = g.name ? names.get(g.nameLower.trim()) : null;
      // Same-source repeats are distinct purchases (distinct order keys or parent IDs).
      g.sameNamePurchases = n ? n[g.source] : 1;
      // Cross-source name matches are never treated as the same purchase.
      g.sharedNameUnconfirmed = Boolean(n && n.historical && n.native);
    }
    return { groups: list, native: { enabled: Boolean(entitlements?.ENABLED), present: Boolean(native.scope), error: native.error,
      unresolved: native.scope?.sync?.unresolved ?? 0, coverage: native.scope?.sync?.coverage ?? null } };
  }

  // Read-only historical/native reconciliation for presentation. Historical order keys and
  // native IDs share nothing, so a match is inferred from evidence and never stored:
  // the same normalized name with most of the smaller record's titles shared, or similar
  // names with the smaller record wholly contained. Content alone is not enough, because
  // smaller bundles nest inside larger ones. Pairs are accepted in rounds when each side is
  // the other's unique best candidate, so the result does not depend on input order.
  const matchKey = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[‘’“”'"`]/gu, '').replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const NAME_STOP = new Set(['the', 'and', 'bundle', 'humble', 'of', 'by']);
  const nameTokens = s => new Set(matchKey(s).split(' ').filter(w => w.length > 1 && !NAME_STOP.has(w)));
  function similarity(a, b) {
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    const union = a.size + b.size - shared;
    return union ? shared / union : 0;
  }
  function titleCounts(g) {
    const counts = new Map();
    for (const i of g.items) { const k = matchKey(i.title); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return counts;
  }
  const signature = counts => JSON.stringify([...counts].sort((a, b) => a[0] < b[0] ? -1 : 1));
  // Candidate rank: name evidence first, then coverage of the smaller record, shared titles, name similarity.
  const rank = c => [c.sameName ? 1 : 0, c.ratio, c.shared, c.similarity];
  function compareRank(a, b) { const x = rank(a), y = rank(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k]; return 0; }
  function uniqueBest(list) {
    if (!list?.length) return null;
    const sorted = [...list].sort(compareRank);
    return sorted[1] && compareRank(sorted[0], sorted[1]) === 0 ? 'tie' : sorted[0];
  }

  function mergeItems(h, n) {
    const native = new Map();
    for (const i of n.items) { const k = matchKey(i.title); if (!native.has(k)) native.set(k, []); native.get(k).push(i); }
    const items = [], paired = new Map();
    for (const i of h.items) {
      const key = matchKey(i.title), twin = native.get(key)?.shift();
      // A title present in both records is shown once; native entitlements are never collapsed.
      if (twin) {
        const entry = { ...twin, source: 'both', kind: i.kind, category: i.category !== 'unknown' ? i.category : twin.category, historicalTitle: i.title !== twin.title ? i.title : null, historicalRecords: 1 };
        items.push(entry); paired.set(key + '\n' + i.kind, entry);
        continue;
      }
      // The old importer could record one title more than once in an order; extra records of
      // a matched title and kind are counted on that entry rather than listed again.
      const same = paired.get(key + '\n' + i.kind);
      if (same) same.historicalRecords++;
      else items.push({ ...i });
    }
    for (const rest of native.values()) items.push(...rest);
    return items;
  }

  function unify(h, n, evidence) {
    const items = mergeItems(h, n).sort((a, b) => COLLATOR.compare(a.title, b.title));
    const g = { key: 'u:' + h.key + '|' + n.key, source: 'unified', historical: h, native: n, evidence,
      name: n.name || h.name, historicalName: h.name !== n.name ? h.name : null, type: n.type, purchasedAt: h.purchasedAt, listedCount: h.listedCount, orderRecorded: h.orderRecorded,
      parentId: n.parentId, route: n.route, items, matchState: 'matched', sameNamePurchases: Math.max(h.sameNamePurchases, n.sameNamePurchases), sharedNameUnconfirmed: false,
      onlyNative: items.filter(i => i.source === 'native').length, onlyHistorical: items.filter(i => i.source === 'historical').length };
    finishGroup(g);
    return g;
  }

  function reconcile(groups) {
    const H = groups.filter(g => g.source === 'historical'), N = groups.filter(g => g.source === 'native');
    const info = new Map(groups.map(g => [g, { name: matchKey(g.name), tokens: nameTokens(g.name), titles: titleCounts(g) }]));
    const index = new Map(), byName = new Map();
    for (const n of N) {
      for (const k of info.get(n).titles.keys()) { if (!index.has(k)) index.set(k, []); index.get(k).push(n); }
      const name = info.get(n).name; if (name) { if (!byName.has(name)) byName.set(name, []); byName.get(name).push(n); }
    }
    const candidates = [], conflicts = new Set();
    for (const h of H) {
      const hi = info.get(h), shared = new Map();
      for (const k of hi.titles.keys()) for (const n of index.get(k) ?? []) shared.set(n, (shared.get(n) ?? 0) + 1);
      for (const n of byName.get(hi.name) ?? []) if (!shared.has(n)) shared.set(n, 0);
      for (const [n, s] of shared) {
        const ni = info.get(n), smaller = Math.min(hi.titles.size, ni.titles.size), sameName = Boolean(hi.name) && hi.name === ni.name;
        const c = { h, n, shared: s, ratio: smaller ? s / smaller : 0, sameName, similarity: similarity(hi.tokens, ni.tokens) };
        if (s && (sameName ? c.ratio >= 0.5 : c.ratio === 1 && c.similarity >= 0.5)) candidates.push(c);
        // Same name but clearly different contents: different purchases, never combined.
        else if (sameName && smaller >= 3 && c.ratio < 0.2) { conflicts.add(h); conflicts.add(n); }
      }
    }
    const matched = new Map(), taken = new Set();
    const accept = (c, extra = {}) => { matched.set(c.h, { ...c, ...extra }); taken.add(c.n); };
    for (let progress = true; progress;) {
      progress = false;
      const live = candidates.filter(c => !matched.has(c.h) && !taken.has(c.n)), byH = new Map(), byN = new Map();
      for (const c of live) { if (!byH.has(c.h)) byH.set(c.h, []); byH.get(c.h).push(c); if (!byN.has(c.n)) byN.set(c.n, []); byN.get(c.n).push(c); }
      const round = [...byH.values()].map(uniqueBest).filter(c => c && c !== 'tie' && uniqueBest(byN.get(c.n)) === c);
      for (const c of round) accept(c);
      if (round.length) { progress = true; continue; }
      // Repeat purchases of one bundle: with equal counts, every cross pair a candidate and
      // identical contents on one side, any pairing is equivalent. Pair them in a fixed order.
      const sets = new Map();
      for (const c of live) if (c.sameName) { const k = info.get(c.h).name; if (!sets.has(k)) sets.set(k, { hs: new Set(), ns: new Set(), pairs: new Set() }); const s = sets.get(k); s.hs.add(c.h); s.ns.add(c.n); s.pairs.add(c); }
      for (const s of sets.values()) {
        const hs = [...s.hs], ns = [...s.ns];
        if (hs.length < 2 || hs.length !== ns.length || s.pairs.size !== hs.length * ns.length) continue;
        const same = list => new Set(list.map(g => signature(info.get(g).titles))).size === 1;
        if (!same(hs) && !same(ns)) continue;
        hs.sort((a, b) => (a.purchasedAt ?? Infinity) - (b.purchasedAt ?? Infinity) || (a.key < b.key ? -1 : 1));
        ns.sort((a, b) => a.key < b.key ? -1 : 1);
        hs.forEach((h, i) => accept([...s.pairs].find(c => c.h === h && c.n === ns[i]), { interchangeable: hs.length }));
        progress = true;
      }
    }
    const pending = new Set(candidates.flatMap(c => matched.has(c.h) || taken.has(c.n) ? [] : [c.h, c.n]));
    const state = g => matched.has(g) || taken.has(g) ? 'matched' : conflicts.has(g) ? 'conflicting' : pending.has(g) ? 'ambiguous' : 'unmatched';
    for (const g of groups) g.matchState = state(g);
    const unified = [...matched.values()].map(c => unify(c.h, c.n, { sameName: c.sameName, shared: c.shared, smaller: Math.round(c.shared / c.ratio), interchangeable: c.interchangeable ?? 0 }));
    const rest = groups.filter(g => g.matchState !== 'matched');
    const count = s => groups.filter(g => g.matchState === s).length;
    return { groups: [...unified, ...rest], stats: { historical: H.length, native: N.length, matched: unified.length, interchangeable: unified.filter(g => g.evidence.interchangeable).length,
      similarName: unified.filter(g => !g.evidence.sameName).length, ambiguous: count('ambiguous'), conflicting: count('conflicting'), unmatchedHistorical: H.filter(g => g.matchState === 'unmatched').length,
      unmatchedNative: N.filter(g => g.matchState === 'unmatched').length, unified: unified.length + rest.length } };
  }

  // scope: 'title' (contained titles), 'bundle' (group names) or 'both'.
  // Where a key reminder's Open control goes. Reminders name a historical order key, which has
  // had no working Humble route since the 2026 redesign. A Humble Library destination is offered
  // only through one non-interchangeable presentation match, is labelled as likely, and is
  // worked out on each render; nothing is stored. Everything else opens the Library itself.
  function reminderDestination(reminder, groups) {
    const fallback = reason => ({ kind: 'library', url: HUMBLE + '/home/library', reason });
    if (!Array.isArray(groups)) return fallback('not-synced');
    const key = 'h:' + reminder?.purchaseKey;
    const match = groups.find(g => g.source === 'unified' && g.historical.key === key);
    if (!match) return fallback(groups.find(g => g.source === 'historical' && g.key === key)?.matchState ?? 'no-record');
    if (match.evidence.interchangeable) return fallback('repeat');
    if (!match.route) return fallback('unmatched');
    const title = matchKey(reminder.title), steam = /steam/iu.test(reminder.keyType ?? '');
    // Reminders are about keys, so a DRM-free download of the same title is not the destination.
    const items = match.native.items.filter(i => !i.excluded && i.route && i.namespace !== 'download_drm_free' && (!steam || i.namespace === 'steam') && matchKey(i.title) === title);
    const base = { name: match.name, likely: true };
    return items.length === 1 ? { ...base, kind: 'entitlement', url: items[0].route } : { ...base, kind: 'purchase', url: match.route };
  }

  function filterGroups(groups, { search = '', scope = 'both', media = '', filter = '', type = '', sort = 'name-asc' } = {}) {
    const q = lower(search).trim(), collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const out = [];
    for (const g of groups) {
      if (media && (media === 'mixed' ? g.media !== 'mixed' : media === 'unknown' ? g.media !== 'unknown' : !g.categories[media])) continue;
      if (type && g.type !== type) continue;
      // Source filters mean "not combined with the other source" in both display modes.
      if (filter === 'both' && g.matchState !== 'matched' || filter === 'historical' && (g.source !== 'historical' || g.matchState === 'matched')
        || filter === 'native' && (g.source !== 'native' || g.matchState === 'matched') || filter === 'ambiguous' && g.matchState !== 'ambiguous' && g.matchState !== 'conflicting'
        || filter === 'repeat' && g.sameNamePurchases < 2 || filter === 'excluded' && !g.excluded) continue;
      let nameMatch = false, matches = [];
      if (q) {
        nameMatch = scope !== 'title' && g.nameLower.includes(q);
        if (scope !== 'bundle') g.titlesLower.forEach((t, i) => { if (t.includes(q)) matches.push(i); });
        if (!nameMatch && !matches.length) continue;
      }
      out.push({ group: g, nameMatch, matches });
    }
    const name = r => r.group.name ?? '', date = r => r.group.purchasedAt, size = r => r.group.items.length;
    // Unnamed groups sort after named ones in either direction.
    const byName = (a, b, dir = 1) => (a.group.name ? 0 : 1) - (b.group.name ? 0 : 1) || dir * collator.compare(name(a), name(b)) || collator.compare(a.group.key, b.group.key);
    const byDate = dir => (a, b) => date(a) === null ? (date(b) === null ? byName(a, b) : 1) : date(b) === null ? -1 : dir * (date(a) - date(b)) || byName(a, b);
    out.sort(sort === 'name-desc' ? (a, b) => byName(a, b, -1) : sort === 'date-desc' ? byDate(-1) : sort === 'date-asc' ? byDate(1)
      : sort === 'count-desc' ? (a, b) => size(b) - size(a) || byName(a, b) : sort === 'count-asc' ? (a, b) => size(a) - size(b) || byName(a, b) : byName);
    return out;
  }

  global.HumbleLibraryBrowser = Object.freeze({ buildGroups, reconcile, filterGroups, reminderDestination, purchaseRoute, entitlementRoute, category });
})(globalThis);
