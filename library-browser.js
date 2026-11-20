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
    return { key, name: null, type: 'unknown', purchasedAt: null, dateSource: null, firstSeenAt: null, listedCount: null, orderRecorded: false, parentId: null, route: null, items: [], ...fields };
  }

  // Native groups need an enabled collector and the active account's own scope.
  function nativeScope({ libraryEntitlements, humbleAccountId, entitlements }) {
    if (!entitlements?.ENABLED || !libraryEntitlements || typeof humbleAccountId !== 'string') return { scope: null, error: false };
    try {
      const scopes = entitlements.collection(libraryEntitlements).scopes;
      return { scope: scopes.find(s => s.localAccountId !== null && s.localAccountId === humbleAccountId) ?? null, error: false };
    } catch { return { scope: null, error: true }; }
  }

  function buildGroups({ items = [], purchaseSummaries = [], libraryEntitlements = null, humbleAccountId = null, mediaTypeOverrides = null, entitlements = global.HumbleLibraryEntitlements } = {}) {
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
    // Purchase dates matched from Humble's Order History by purchase name (see orderDates).
    const dated = native.scope && entitlements.orderDates ? entitlements.orderDates(native.scope) : new Map();
    for (const r of native.scope?.observations ?? []) {
      // A local media correction for this entitlement applies here and in bundle-page matching.
      const automatic = kinds ? entitlements.resolvedMedia(r, kinds) : r.mediaType;
      const manualKey = entitlements?.nativeMediaKey?.(r), manual = manualKey && mediaTypeOverrides && Object.hasOwn(mediaTypeOverrides, manualKey) ? mediaTypeOverrides[manualKey] : null;
      const media = manual ? entitlements.resolvedMedia(r, kinds, mediaTypeOverrides) : automatic;
      const key = 'n:' + r.parentId;
      if (!groups.has(key)) {
        const at = time(dated.get(r.parentId)?.purchasedAt);
        groups.set(key, group(key, { source: 'native', parentId: r.parentId, type: NATIVE_TYPES[r.eligibility?.parentType] ?? 'unknown', route: purchaseRoute(r.parentId), purchasedAt: at, dateSource: at === null ? null : 'order-history' }));
      }
      const g = groups.get(key);
      if (!g.name && r.parentTitle) g.name = r.parentTitle;
      g.items.push({ title: r.title, kind: media, category: category(media), source: 'native', status: r.purchaseStatus, excluded: r.purchaseStatus !== 'purchased',
        gifted: r.eligibility?.giftStatus === 'gifted', namespace: r.namespace, activation: r.activationStatus, nativeId: r.nativeId, route: entitlementRoute(r.nativeId),
        ...(manual ? { manualKind: manual, automaticKind: automatic } : {}),
        downloads: Boolean(r.delivery?.formats?.length || r.delivery?.platforms?.length) });
      // When a sync first saw the purchase: its earliest entitlement. Unknown if any entitlement was
      // saved before first-seen times were recorded. Never a purchase date.
      const seen = time(r.firstObservedAt);
      g.firstSeenAt = g.items.length === 1 ? seen : g.firstSeenAt === null || seen === null ? null : Math.min(g.firstSeenAt, seen);
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
      name: n.name || h.name, historicalName: h.name !== n.name ? h.name : null, type: n.type, purchasedAt: h.purchasedAt ?? n.purchasedAt, dateSource: h.purchasedAt !== null ? null : n.dateSource ?? null, firstSeenAt: n.firstSeenAt, listedCount: h.listedCount, orderRecorded: h.orderRecorded,
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
  function reminderDestination(reminder, groups, index) {
    const fallback = reason => ({ kind: 'library', url: HUMBLE + '/home/library', reason });
    if (!Array.isArray(groups)) return fallback('not-synced');
    const key = 'h:' + reminder?.purchaseKey;
    const candidate = index ? index.get(key) : groups.find(g => g.source === 'unified' ? g.historical.key === key : g.source === 'historical' && g.key === key);
    if (candidate?.source !== 'unified') return fallback(candidate?.matchState ?? 'no-record');
    const match = candidate;
    if (match.evidence.interchangeable) return fallback('repeat');
    const title = matchKey(reminder.title), steam = /steam/iu.test(reminder.keyType ?? '');
    // Reminders are about keys, so a DRM-free download of the same title is not the destination.
    const items = match.native.items.filter(i => !i.excluded && i.namespace !== 'download_drm_free' && (!steam || i.namespace === 'steam') && matchKey(i.title) === title);
    const base = { name: match.name, likely: true };
    if (items.length === 1 && items[0].route) return { ...base, kind: 'entitlement', url: items[0].route, purchaseUrl: match.route };
    return match.route ? { ...base, kind: 'purchase', url: match.route } : fallback('unmatched');
  }

  // Verified Humble pages for the Titles view, keyed like the Titles list (exact normalized title).
  // Only native entitlement routes are used, never historical order keys or titles, and excluded
  // (gifted, revoked, temporary) entitlements are left out. A historical title spelled differently
  // is linked only through the reconciliation's own pairing inside one likely-matched purchase;
  // that pairing is computed per render and never stored. One entitlement is listed once.
  const titleKey = v => String(v ?? '').normalize('NFKC').trim().toLowerCase();
  // Each copy also records how the reconciliation placed its purchase: combined with an imported
  // order (historicalKey), one of several interchangeable repeats, or not combined (matchState).
  function titleLinks(groups, reconciliation = null) {
    const links = new Map(), paired = new Set();
    const unified = new Map((reconciliation?.groups ?? []).filter(g => g.source === 'unified').map(g => [g.native.key, g]));
    // A Library purchase's date as Bundles & Orders shows it: the imported order it is combined with, else its own
    // (Order History) date. Combined repeats of one bundle hold the same titles, so each title still gets every
    // repeat's date even though which repeat pairs with which order is arbitrary.
    const purchaseDate = native => unified.get(native.key)?.purchasedAt ?? native.purchasedAt ?? null;
    const add = (key, entry, native) => {
      if (!key || entry.excluded || !entry.route || entry.route !== entitlementRoute(entry.nativeId)) return;
      const list = links.get(key) ?? [];
      if (list.some(c => c.nativeId === entry.nativeId)) return;
      const u = unified.get(native.key);
      list.push({ nativeId: entry.nativeId, parentId: native.parentId, route: entry.route, title: entry.title, purchase: native.name || '', type: native.type, namespace: entry.namespace, kind: entry.kind, steam: entry.namespace === 'steam', firstSeenAt: native.firstSeenAt, purchasedAt: purchaseDate(native),
        historicalKey: u ? u.historical.key : null, interchangeable: u ? u.evidence.interchangeable : 0, matchState: native.matchState ?? 'unmatched' });
      links.set(key, list);
    };
    for (const g of groups ?? []) if (g.source === 'native') for (const e of g.items) add(titleKey(e.title), e, g);
    for (const g of unified.values()) {
      for (const e of g.items) if (e.source === 'both' && e.historicalTitle && titleKey(e.historicalTitle) !== titleKey(e.title)) { add(titleKey(e.historicalTitle), e, g.native); paired.add(e.nativeId); }
    }
    for (const list of links.values()) list.sort((a, b) => COLLATOR.compare(a.purchase, b.purchase) || (a.nativeId < b.nativeId ? -1 : 1));
    return { links, paired, key: titleKey, purchaseDate };
  }

  // One list of purchases for an expanded title. An imported order and a Library copy share a row only
  // when the reconciliation combined that order with the copy's purchase, the title appears once on
  // each side, and the pairing is not one of several interchangeable repeats. That shared row is a
  // likely match for display, never a stored identity; every other record keeps its own row.
  function titlePurchases(records, copies) {
    const keyOf = r => r.purchaseKey ? 'h:' + r.purchaseKey : 'hn:' + lower(r.sourceBundle).trim();
    const used = new Set();
    const rows = (records ?? []).map(record => {
      if (!record?.purchaseKey && !String(record?.sourceBundle ?? '').trim()) return { record, copy: null };
      const key = keyOf(record);
      const candidates = (copies ?? []).filter(c => c.historicalKey === key && !c.interchangeable && !used.has(c.nativeId));
      if (records.filter(r => keyOf(r) === key).length !== 1 || candidates.length !== 1) return { record, copy: null };
      used.add(candidates[0].nativeId);
      return { record, copy: candidates[0] };
    });
    return { rows, rest: (copies ?? []).filter(c => !used.has(c.nativeId)) };
  }

  // How many times a title was bought, for its Titles heading. Imported orders count once each (by order
  // key, else bundle name); Humble Library copies count once per purchase, not per entitlement. An
  // imported order the reconciliation combined with a Library purchase containing this title is that
  // purchase and counts once. If some imported orders and some Library purchases remain uncombined,
  // they may be the same purchases, so only the smallest possible total is given (exact: false).
  function titlePurchaseCount(records, copies) {
    const orders = new Set((records ?? []).map((r, i) => r?.purchaseKey ? 'h:' + r.purchaseKey : String(r?.sourceBundle ?? '').trim() ? 'hn:' + lower(r.sourceBundle).trim() : 'record:' + i));
    const purchases = new Set((copies ?? []).map(c => c.parentId)), combinedOrders = new Set(), combinedPurchases = new Set();
    for (const c of copies ?? []) if (c.historicalKey && orders.has(c.historicalKey)) { combinedOrders.add(c.historicalKey); combinedPurchases.add(c.parentId); }
    const otherOrders = orders.size - combinedOrders.size, otherPurchases = purchases.size - combinedPurchases.size;
    const min = purchases.size + Math.max(0, otherOrders - otherPurchases), max = purchases.size + otherOrders;
    return min === max ? { count: min, exact: true } : { count: min, max, exact: false };
  }

  // What the Options browser shows from the active account's native records. Sync progress
  // (checkpoints) and re-observation times are left out, so progress alone never rebuilds the browser.
  function nativeSignature(libraryEntitlements, humbleAccountId) {
    const scope = Array.isArray(libraryEntitlements?.scopes) && typeof humbleAccountId === 'string'
      ? libraryEntitlements.scopes.find(s => s?.localAccountId === humbleAccountId) : null;
    if (!scope) return 'none';
    const parts = [];
    for (const r of Array.isArray(scope.observations) ? scope.observations : []) {
      parts.push([r?.namespace, r?.nativeId, r?.title, r?.parentId, r?.parentTitle, r?.mediaType, r?.purchaseStatus, r?.eligibility?.giftStatus, r?.eligibility?.parentType, r?.firstObservedAt].join('\u0001'));
    }
    // Order History lines date purchases. Unverified rows are counted in the browser note; other checkpoint fields are sync progress.
    const orders = scope.orders?.lines && typeof scope.orders.lines === 'object' ? Object.entries(scope.orders.lines).map(([ref, line]) => [ref, line?.name, line?.at].join('\u0001')).join('\u0002') : '';
    return scope.localAccountId + '\u0002' + parts.join('\u0002') + '\u0002' + (scope.sync?.unresolved ?? 0) + '\u0003' + orders;
  }

  // "Recently added" order: when a sync first saw a Humble Library purchase that is not one of the
  // imported orders. A purchase combined with an imported order, or one that might be (ambiguous or
  // conflicting), is not new to the library, so it has no added time; neither do purchases saved
  // before first-seen times were recorded. An added time is never a purchase date or ownership evidence.
  function recentlyAdded(g) {
    return g?.source === 'native' && g.matchState === 'unmatched' ? g.firstSeenAt ?? null : null;
  }
  // A title's added time: its most recently added purchase among its Humble Library copies.
  function titleAddedAt(copies) {
    let latest = null;
    for (const c of copies ?? []) if (c.matchState === 'unmatched' && c.firstSeenAt != null && (latest === null || c.firstSeenAt > latest)) latest = c.firstSeenAt;
    return latest;
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
        || filter === 'repeat' && g.sameNamePurchases < 2 || filter === 'excluded' && !g.excluded || filter === 'undated' && g.purchasedAt !== null) continue;
      let nameMatch = false, matches = [];
      if (q) {
        nameMatch = scope !== 'title' && g.nameLower.includes(q);
        if (scope !== 'bundle') g.titlesLower.forEach((t, i) => { if (t.includes(q)) matches.push(i); });
        if (!nameMatch && !matches.length) continue;
      }
      out.push({ group: g, nameMatch, matches });
    }
    const name = r => r.group.name ?? '', date = r => r.group.purchasedAt, size = r => r.group.items.length, added = r => recentlyAdded(r.group);
    // Unnamed groups sort after named ones in either direction.
    const byName = (a, b, dir = 1) => (a.group.name ? 0 : 1) - (b.group.name ? 0 : 1) || dir * collator.compare(name(a), name(b)) || collator.compare(a.group.key, b.group.key);
    // Undated purchases come last in both directions, never mixed in as old dates, as in Fanatical Library.
    const byDate = dir => (a, b) => date(a) === null ? (date(b) === null ? byName(a, b) : 1) : date(b) === null ? -1 : dir * (date(a) - date(b)) || byName(a, b);
    // Recently added first; everything else follows newest purchase first.
    const byAdded = (a, b) => added(a) === null ? (added(b) === null ? byDate(-1)(a, b) : 1) : added(b) === null ? -1 : added(b) - added(a) || byName(a, b);
    out.sort(sort === 'name-desc' ? (a, b) => byName(a, b, -1) : sort === 'date-desc' ? byDate(-1) : sort === 'date-asc' ? byDate(1) : sort === 'added-desc' ? byAdded
      : sort === 'count-desc' ? (a, b) => size(b) - size(a) || byName(a, b) : sort === 'count-asc' ? (a, b) => size(a) - size(b) || byName(a, b) : byName);
    return out;
  }

  const contentPlaceholder = entry => global.HumbleComicLibrary.contentPlaceholder(entry);

  function nativeOnlyTitles(model, items, links = null) {
    const key = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
    // An imported placeholder is not a title, so it never hides a Library product of the same name.
    const historical = new Set(items.filter(item => typeof item === 'string' || !contentPlaceholder(item)).map(item => key(typeof item === 'string' ? item : item?.title)));
    const titles = new Map();
    for (const group of model.groups) {
      if (group.source !== 'native') continue;
      for (const entry of group.items) {
        // A copy the reconciliation pairs with a differently spelled historical title is listed there.
        if (entry.excluded || historical.has(key(entry.title)) || links?.paired.has(entry.nativeId) || contentPlaceholder(entry)) continue;
        const k = key(entry.title);
        if (!titles.has(k)) titles.set(k, { title: entry.title, kind: entry.kind && entry.kind !== 'unknown' ? entry.kind : 'unclassified', nativeOnly: true, provenance: [], nativeCopies: [] });
        const title = titles.get(k);
        const at = links?.purchaseDate ? links.purchaseDate(group) : group.purchasedAt ?? null, iso = at === null ? null : new Date(at).toISOString();
        title.nativeCopies.push({ purchase: group.name || '', type: group.type, parentId: group.parentId, route: entry.route, steam: entry.namespace === 'steam', media: entry.kind && entry.kind !== 'unknown' ? entry.kind : null, firstSeenAt: group.firstSeenAt, purchasedAt: at,
          namespace: entry.namespace, nativeId: entry.nativeId, automaticKind: entry.automaticKind ?? entry.kind, ...(entry.manualKind ? { manualKind: entry.manualKind } : {}) });
        // One record per purchase name and date: repeat purchases with different dates keep each date.
        if (group.name && !title.provenance.some(rec => rec.sourceBundle === group.name && (rec.purchasedAt ?? null) === iso))
          title.provenance.push({ sourceBundle: group.name, ...(iso ? { purchasedAt: iso } : {}) });
      }
    }
    return [...titles.values()];
  }

  // Keys Humble's Library lists as not yet redeemed, from the active account's synced purchases.
  // Redeeming on Humble reveals a key; whether it was then activated on Steam or another store is
  // unknown either way. Only an explicit "not redeemed" record counts: unknown stays out. A key Humble
  // marks expired is listed separately. Reviews (dismissed, snoozed) apply only while the status they
  // were made for is unchanged, so a changed key is reviewed again.
  function keyReminders(state, reviews = {}, now = Date.now()) {
    const E = global.HumbleLibraryEntitlements, validKeyReview = global.HumbleComicLibrary.validKeyReview;
    if (!E?.ENABLED) return [];
    const rows = [];
    for (const s of E.collection(state?.libraryEntitlements ?? undefined).scopes) {
      if (s.localAccountId !== (state.humbleAccountId ?? null) || s.localAccountId === null && (s.profileLabel !== (state.humbleProfileLabel ?? '') || state.libraryItems?.length)) continue;
      // Purchase dates matched from Order History, as Bundles & Orders shows them; otherwise unknown.
      const dated = E.orderDates ? E.orderDates(s) : new Map();
      for (const r of s.observations) {
        // A key Humble lists as not redeemed is actionable. One whose redemption Humble does not report
        // is listed under Unknown key status (basis needs-review), never as Active and never dropped.
        const redeemed = r.eligibility?.redeemedAt?.state;
        if (r.namespace === 'download_drm_free' || r.purchaseStatus !== 'purchased' || !['none', 'unknown'].includes(redeemed)) continue;
        const status = r.eligibility.expired === true ? 'expired' : redeemed === 'unknown' ? 'needs-review' : 'unrevealed', ref = E.identity(r), review = validKeyReview(reviews?.[ref]) ? reviews[ref] : null;
        const hidden = Boolean(review && review.basis === status && (review.action === 'dismissed' || review.action === 'snoozed' && Date.parse(review.until) > now));
        rows.push({ ref, title: r.title, bundle: r.parentTitle ?? '', status, hidden, review, purchasedAt: dated.get(r.parentId)?.purchasedAt ?? null,
          itemUrl: entitlementRoute(r.nativeId), purchaseUrl: purchaseRoute(r.parentId),
          availableUntil: r.eligibility.unavailableAfter?.state === 'date' ? r.eligibility.unavailableAfter.value : null, checkedAt: r.observedAt });
      }
    }
    const at = row => row.availableUntil ? Date.parse(row.availableUntil) : Infinity;
    return rows.sort((a, b) => at(a) - at(b) || globalThis.LibraryTitleSort.compare(a.title, b.title) || (a.ref < b.ref ? -1 : 1));
  }

  function unifiedKeyReminders(state, groups, reviews = {}, now = Date.now()) {
    const native = keyReminders(state, reviews, now).map(row => ({...row, native: true, targets: [{ref: row.ref, basis: row.status}]}));
    const legacy = new Map(), byItem = new Map();
    const orders = new Map();
    for (const group of groups ?? []) {
      if (group.source === 'unified') orders.set(group.historical.key, group);
      if (group.source === 'historical') orders.set(group.key, group);
    }
    for (const record of state.keyReminders ?? []) {
      const ref = JSON.stringify(['legacy', state.humbleAccountId || state.humbleProfileLabel || '', record.purchaseKey, record.id]);
      if (legacy.has(ref)) continue;
      const destination = reminderDestination(record, groups, orders);
      const inferred = new Date(Date.parse(record.checkedAt) + (record.daysUntilExpiry >= 0 ? record.daysUntilExpiry * 86400000 : NaN));
      const availableUntil = record.expiresAt || (Number.isFinite(record.daysUntilExpiry) && Number.isFinite(inferred.getTime()) ? inferred.toISOString() : null);
      const status = record.isExpired ? 'expired' : record.status;
      const row = {ref, title: record.title, bundle: record.sourceBundle, status, availableUntil, purchasedAt: record.purchasedAt,
        keyType: record.keyType, directRedeem: record.directRedeem,
        checkedAt: record.checkedAt, destination, itemUrl: destination.kind === 'entitlement' ? destination.url : null,
        purchaseUrl: destination.kind === 'purchase' ? destination.url : destination.purchaseUrl, targets: [{ref, basis: status}]};
      legacy.set(ref, row);
      if (row.itemUrl) {
        const candidates = byItem.get(row.itemUrl) ?? [];
        candidates.push(row);
        byItem.set(row.itemUrl, candidates);
      }
    }
    const nativeCounts = new Map();
    for (const row of native) nativeCounts.set(row.itemUrl, (nativeCounts.get(row.itemUrl) ?? 0) + 1);
    for (const row of native) {
      const candidates = byItem.get(row.itemUrl);
      if (nativeCounts.get(row.itemUrl) !== 1 || candidates?.length !== 1) continue;
      const [older] = candidates;
      row.targets.push(...older.targets);
      row.combined = true;
      row.destination = older.destination;
      row.purchasedAt ??= older.purchasedAt;
      row.keyType = older.keyType;
      row.directRedeem = older.directRedeem;
      row.bundle ||= older.bundle;
      row.availableUntil ||= older.availableUntil;
      legacy.delete(older.ref);
    }
    return [...native, ...legacy.values()].map(row => {
      const decisions = row.targets.map(target => {
        const review = reviews[target.ref];
        return global.HumbleComicLibrary.validKeyReview(review) && review.basis === target.basis ? review : null;
      }).filter(Boolean).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      // Changed current evidence reopens the card, even if an old source still reports the old state.
      const ownReview = reviews[row.ref];
      const review = row.native && global.HumbleComicLibrary.validKeyReview(ownReview) && ownReview.basis !== row.status ? null : decisions[0];
      const reviewState = review?.action === 'dismissed' || review?.action === 'snoozed' && Date.parse(review.until) > now ? review.action : 'active';
      const deadline = Date.parse(row.availableUntil);
      const expired = row.status === 'expired' || deadline <= now;
      return {...row, review, reviewState, expired, expiring: !expired && deadline > now && deadline <= now + 30 * 86400000};
    }).sort((a, b) => {
      const priority = row => row.expired ? Infinity : Date.parse(row.availableUntil) || Infinity;
      return priority(a) - priority(b) || Number(a.expired) - Number(b.expired) || global.LibraryTitleSort.compare(a.title, b.title);
    });
  }

  global.HumbleLibraryBrowser = Object.freeze({ keyReminders, unifiedKeyReminders, buildGroups, nativeOnlyTitles, contentPlaceholder, reconcile, filterGroups, recentlyAdded, titleAddedAt, reminderDestination, titleLinks, titlePurchases, titlePurchaseCount, nativeSignature, purchaseRoute, entitlementRoute, category });
})(globalThis);
