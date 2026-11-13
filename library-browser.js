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
    for (const r of native.scope?.observations ?? []) {
      const key = 'n:' + r.parentId;
      if (!groups.has(key)) groups.set(key, group(key, { source: 'native', parentId: r.parentId, type: NATIVE_TYPES[r.eligibility?.parentType] ?? 'unknown', route: purchaseRoute(r.parentId) }));
      const g = groups.get(key);
      if (!g.name && r.parentTitle) g.name = r.parentTitle;
      g.items.push({ title: r.title, kind: r.mediaType, category: r.mediaType === 'game' ? 'game' : 'unknown', source: 'native', status: r.purchaseStatus, excluded: r.purchaseStatus !== 'purchased',
        gifted: r.eligibility?.giftStatus === 'gifted', namespace: r.namespace, activation: r.activationStatus, nativeId: r.nativeId, route: entitlementRoute(r.nativeId) });
    }
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const list = [...groups.values()];
    const names = new Map();
    for (const g of list) {
      g.items.sort((a, b) => collator.compare(a.title, b.title));
      g.nameLower = lower(g.name);
      g.titlesLower = g.items.map(i => lower(i.title));
      g.categories = {};
      for (const i of g.items) g.categories[i.category] = (g.categories[i.category] ?? 0) + 1;
      const known = Object.keys(g.categories).filter(c => c !== 'unknown');
      g.media = known.length > 1 ? 'mixed' : known[0] ?? 'unknown';
      g.excluded = g.items.filter(i => i.excluded).length;
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

  // scope: 'title' (contained titles), 'bundle' (group names) or 'both'.
  function filterGroups(groups, { search = '', scope = 'both', media = '', filter = '', type = '', sort = 'name-asc' } = {}) {
    const q = lower(search).trim(), collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const out = [];
    for (const g of groups) {
      if (media && (media === 'mixed' ? g.media !== 'mixed' : media === 'unknown' ? g.media !== 'unknown' : !g.categories[media])) continue;
      if (type && g.type !== type) continue;
      if (filter === 'historical' && g.source !== 'historical' || filter === 'native' && g.source !== 'native' || filter === 'shared-name' && !g.sharedNameUnconfirmed
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

  global.HumbleLibraryBrowser = Object.freeze({ buildGroups, filterGroups, purchaseRoute, entitlementRoute, category });
})(globalThis);
