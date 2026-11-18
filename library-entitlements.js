// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
/* Independent Library observations. Never a replacement for purchase history. */
(function (global) {
  'use strict';
  const ENABLED = true; // Validated against a live Library; disable only to withdraw the collector.
  const MAX_RECORDS = 100000, MAX_PAGES = 10, MAX_PARENTS = 20, MAX_REFRESH_PAGES = 40;
  const DETAIL_PARENT_TYPES = new Set(['storefront','widget']);
  const SYNC_STATUSES = ['running','paused','completed','cancelled','stopped'];
  const SYNC_REASONS = ['user','rate-limited','signed-out','account','superseded','failed','incompatible','session-limit'];
  const UNCERTAINTY = ['totals-changed','ordering-changed','items-unresolved','duplicate-conflict','pagination-loop','items-missed'];
  // Conservative defaults. Validation enforces floors so settings cannot make the scan aggressive.
  // Rows per Library request. The site's own pager asks for 5, but the same read-only action
  // honours larger limits. Fewer page boundaries also lose fewer rows to Humble's unstable
  // most-recent order. Records without a size were read 5 rows at a time.
  const PAGE_SIZES = Object.freeze({ full: 1000, refresh: 50 }), LEGACY_PAGE_SIZE = 5, BATCH_ROWS = 1000;
  const rowsPerPage = v => { const n = v ?? LEGACY_PAGE_SIZE; if (![LEGACY_PAGE_SIZE, PAGE_SIZES.full, PAGE_SIZES.refresh].includes(n)) throw Error('Invalid Library page size.'); return n; };
  const SYNC_DEFAULTS = Object.freeze({ batchPages: 10, refreshPages: 1, requestSpacingMs: 1000, batchDelayMs: 5000, retryDelaysMs: Object.freeze([15000, 60000, 180000]), maxSessionRequests: 12000, maxSessionMs: 8 * 3600 * 1000, pageSize: null });
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(v);
  const count = v => { if (!Number.isSafeInteger(v) || v < 0 || v > 1000000) throw Error('Invalid Library sync count.'); return v; };
  const text = (v, max = 500) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/u.test(v)) throw Error('Invalid Library observation text.');
    return v;
  };
  const id = v => { text(v, 250); if (v.startsWith('$')) throw Error('Unresolved Library identity.'); return v; };
  // Provider titles are display metadata. Live titles can contain line breaks or tabs;
  // collapse control-character runs instead of rejecting the purchase. Stored text stays strict.
  const providerTitle = v => text(typeof v === 'string' ? v.replace(/\s*[\u0000-\u001f\u007f]+\s*/gu, ' ').trim() : v);
  const enumeration = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(v) ? v : 'unknown';
  const boolean = v => typeof v === 'boolean' ? v : null;
  const accessFlag = v => { if (v !== undefined && v !== null && typeof v !== 'boolean') throw Error('Invalid Library access evidence.'); return boolean(v); };
  const date = v => {
    if (v === undefined) return { state: 'unknown', value: null };
    if (v === null) return { state: 'none', value: null };
    if (typeof v !== 'string') throw Error('Invalid Library date.');
    const raw = v.startsWith('$D') ? v.slice(2) : v;
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(raw) || !Number.isFinite(Date.parse(raw))) throw Error('Invalid Library date.');
    return { state: 'date', value: new Date(raw).toISOString() };
  };
  const scopeKey = s => JSON.stringify([id(s.principalId), id(s.userId)]);
  const identity = r => JSON.stringify([scopeKey(r.scope), id(r.namespace), id(r.nativeId)]);
  function eligibility(raw) {
    if (!object(raw)) throw Error('Invalid Library eligibility.');
    const result = {};
    for (const name of ['expired','preOrdered','outOfStock','redeemable','directRedeem','parentPreOrder']) {
      if (raw[name] !== null && typeof raw[name] !== 'boolean') throw Error('Invalid Library eligibility flag.');
      result[name] = raw[name];
    }
    for (const name of ['revoked','temporaryAccess']) {
      if (raw[name] !== undefined && raw[name] !== null && typeof raw[name] !== 'boolean') throw Error('Invalid Library access evidence.');
      result[name] = boolean(raw[name]);
    }
    for (const name of ['giftStatus','parentType','integration','redemptionGroups']) result[name] = enumeration(raw[name]);
    for (const name of ['unavailableBefore','unavailableAfter','redeemedAt']) {
      const v = raw[name];
      if (!object(v) || !['unknown','none','date'].includes(v.state) || (v.state === 'date' ? typeof v.value !== 'string' || date(v.value).value !== v.value : v.value !== null)) throw Error('Invalid Library date evidence.');
      result[name] = { state: v.state, value: v.value };
    }
    return result;
  }
  // Download platforms and file-format names as Humble lists them for a DRM-free item. They
  // describe the delivery only; links, file names and hashes are never read or kept.
  const DELIVERY_TOKEN = /^[a-z0-9][a-z0-9 ._+-]{0,23}$/u;
  function delivery(raw) {
    if (raw === undefined || raw === null) return null;
    if (!object(raw) || Object.keys(raw).some(k => !['platforms','formats'].includes(k))) throw Error('Invalid Library delivery evidence.');
    const list = v => { if (!Array.isArray(v) || v.length > 12 || v.some(x => typeof x !== 'string' || !DELIVERY_TOKEN.test(x))) throw Error('Invalid Library delivery evidence.'); return [...new Set(v)].sort(); };
    return { platforms: list(raw.platforms), formats: list(raw.formats) };
  }
  function deliveryEvidence(t, downloads) {
    if (!Array.isArray(downloads)) return null;
    const platforms = new Set(), formats = new Set(), token = v => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s*\((?:zip|rar|7z)\)$/u, '').replace(/^\./u, '') : '';
    for (const d of downloads.slice(0, 50)) {
      const value = t(d);
      if (!object(value)) continue;
      const platform = token(t(value.platform)); if (DELIVERY_TOKEN.test(platform)) platforms.add(platform);
      const files = t(value.downloadStruct);
      for (const f of Array.isArray(files) ? files.slice(0, 50) : []) { const name = token(t(object(t(f)) ? t(f).name : null)); if (DELIVERY_TOKEN.test(name)) formats.add(name); }
    }
    return { platforms: [...platforms].sort().slice(0, 12), formats: [...formats].sort().slice(0, 12) };
  }
  // Key-only stores sell games. Steam keys can be software too; that was never distinguished.
  const GAME_KEYS = new Set(['steam','gog','epic_keyless','origin','uplay','rockstar_social','playstation','nintendo','xbox']);
  const BOOK_FORMATS = new Set(['pdf','epub','mobi','cbz','cbr','azw3','prc']), AUDIO_FORMATS = new Set(['mp3','m4a','m4b','aac','flac','ogg','opus','wav']);
  const EXECUTABLE = ['windows','mac','linux','android','ios'];
  // The historical importer's media order, from provider evidence only: software assets,
  // video, executables (game, or software from a Software Bundle), audio, comics, books.
  function providerMedia(namespace, evidence, parentTitle = '') {
    if (GAME_KEYS.has(namespace)) return 'game';
    if (namespace !== 'download_drm_free' || !evidence) return 'unknown';
    const platforms = new Set(evidence.platforms), formats = new Set(evidence.formats);
    if (evidence.formats.some(f => /^(?:gmz|gmx|yyz|yymp|yymps|gmez|unitypackage|uproject|uasset|blend)$/u.test(f))) return 'software';
    if (platforms.has('video') || evidence.formats.some(f => /^(?:mp4|mkv|mov|m4v|webm)$/u.test(f))) return 'video';
    if (EXECUTABLE.some(x => platforms.has(x))) return /\bsoftware\b/iu.test(parentTitle) ? 'software' : 'game';
    if (platforms.has('audio') || !platforms.has('ebook') && evidence.formats.some(f => AUDIO_FORMATS.has(f))) return 'audiobook';
    if (!platforms.has('ebook') && !evidence.formats.some(f => BOOK_FORMATS.has(f))) return 'unknown';
    return formats.has('cbz') || formats.has('cbr') || /\b(?:comics?|manga|graphic novels?)\b.*\bbundle\b|\bbundle\b.*\b(?:comics?|manga)\b/iu.test(parentTitle) ? 'comic' : 'book';
  }
  const titleKey = v => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[\u2018\u2019\u201c\u201d'"`]/gu, '').replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Comics are books for matching and for GL.
  const family = kind => kind === 'comic' ? 'book' : kind;
  // Media of one title across the account's imported records, when they agree.
  function historicalKinds(items) {
    const kinds = new Map();
    for (const item of items) {
      const k = titleKey(item?.title), kind = String(item?.kind || 'book');
      if (!k || ['unclassified','unknown'].includes(kind)) continue;
      if (!kinds.has(k)) kinds.set(k, new Set());
      kinds.get(k).add(kind);
    }
    return kinds;
  }
  // Older observations have no delivery evidence. Then the same title's imported media, or an
  // explicit Book, Comics, Manga, Software or Audiobook Bundle purchase name, may supply it.
  function resolvedMedia(r, kinds) {
    if (r.mediaType !== 'unknown') return r.mediaType;
    if (r.namespace !== 'download_drm_free') return 'unknown';
    const imported = kinds?.get(titleKey(r.title));
    // Comic and book records of one title agree (comics are books); any other mix is a conflict.
    if (imported) return imported.size === 1 ? [...imported][0] : [...imported].every(k => family(k) === 'book') ? 'comic' : 'unknown';
    const name = r.parentTitle ?? '';
    if (/\b(?:comics?|manga|graphic novels?)\b/iu.test(name) && /\bbundle\b/iu.test(name)) return 'comic';
    if (/\b(?:book|ebook)\s+bundle\b/iu.test(name)) return 'book';
    if (/\bsoftware\s+bundle\b/iu.test(name)) return 'software';
    if (/\baudio\s?books?\b/iu.test(name)) return 'audiobook';
    return 'unknown';
  }
  function admission(r) {
    const e = r.eligibility;
    // Every observation comes from an account-checked Purchased row and exact
    // native child in its authenticated parent. Redemption capability is not
    // purchase evidence, and optional metadata cannot undo that membership.
    if (e.giftStatus === 'gifted' || e.revoked === true || e.temporaryAccess === true) return 'observation-only';
    return r.namespace === 'steam' ? 'humble-key-entitlement' : r.namespace === 'download_drm_free' ? 'personal-drm-free-entitlement' : 'humble-purchased-entitlement';
  }
  function observation(raw) {
    if (!object(raw) || !object(raw.scope) || raw.source !== 'authenticated-humble-library') throw Error('Invalid Library observation.');
    const r = { scope: { principalId: id(raw.scope.principalId), userId: id(raw.scope.userId) },
      namespace: enumeration(raw.namespace), nativeId: id(raw.nativeId), title: text(raw.title),
      parentId: id(raw.parentId), source: 'authenticated-humble-library', observedAt: date(raw.observedAt).value,
      eligibility: eligibility(raw.eligibility) };
    // The parent purchase's display name. Older records were saved without it.
    if (raw.parentTitle !== undefined && raw.parentTitle !== null) r.parentTitle = text(raw.parentTitle);
    const evidence = delivery(raw.delivery); if (evidence) r.delivery = evidence;
    if (r.namespace === 'unknown' || !r.observedAt) throw Error('Library identity or timestamp is missing.');
    // When a sync first saw this entitlement, set once by the storage worker. It is not a purchase
    // date. Records saved before it was recorded have none; an unusable value is left out rather
    // than rejecting the record.
    let first = null; try { first = date(raw.firstObservedAt).value; } catch {}
    if (first && first <= r.observedAt) r.firstObservedAt = first;
    // Media comes from provider evidence only: the key store, or the DRM-free download's platform
    // and file formats. No title-based inference; without evidence it stays unknown.
    r.mediaType = providerMedia(r.namespace, evidence, r.parentTitle);
    r.admission = admission(r); r.activationStatus = 'unknown';
    r.purchaseStatus = r.admission === 'observation-only' ? 'excluded' : 'purchased';
    return r;
  }
  function purchaseViews(state) {
    if (!ENABLED) return [];
    return collection(state.libraryEntitlements).scopes.filter(s => s.localAccountId === state.humbleAccountId).flatMap(s => s.observations.map(r => ({
      itemRef: identity(r), title: r.title, mediaType: r.mediaType,
      status: r.eligibility.revoked === true ? 'Revoked' : r.eligibility.giftStatus === 'gifted' ? 'Gifted away' : r.eligibility.temporaryAccess === true ? 'Temporary access' : 'Purchased',
      activationStatus: 'unknown'
    })));
  }
  function refreshObservation(previous, raw) {
    const next = observation(raw);
    if (!previous) return next;
    const old = observation(previous);
    if (identity(old) !== identity(next) || old.observedAt > next.observedAt) throw Error('Stale or foreign Library observation.');
    const evidence = {...next.eligibility};
    for (const field of ['revoked','temporaryAccess']) if (evidence[field] === null && old.eligibility[field] === true) evidence[field] = true;
    if (evidence.giftStatus === 'unknown' && old.eligibility.giftStatus === 'gifted') evidence.giftStatus = 'gifted';
    // A refresh never sets or moves the first-seen time.
    return observation({...next,eligibility:evidence,parentTitle:next.parentTitle ?? old.parentTitle,delivery:next.delivery ?? old.delivery,firstObservedAt:old.firstObservedAt});
  }
  function scan(raw) {
    if (raw == null) return null;
    if (!object(raw) || !['bounded','incomplete','accessible-pages-traversed'].includes(raw.coverage)
      || !['finished','partial'].includes(raw.acquisition)) throw Error('Invalid Library scan result.');
    const r = { acquisition: raw.acquisition, coverage: raw.coverage, historicalComplete: false, reconciliationAuthority: 'none', checkedAt: date(raw.checkedAt).value };
    if (!r.checkedAt) throw Error('Missing Library scan date.');
    for (const k of ['pagesRead','reportedTotal','reportedPages','verifiedItems','unresolvedItems','duplicateItems','conflictingItems']) {
      if (!Number.isSafeInteger(raw[k]) || raw[k] < 0 || raw[k] > 1000000) throw Error('Invalid Library scan count.');
      r[k] = raw[k];
    }
    // Resumable batches start later in the range. Older records lack the field and began at page one.
    r.firstPage = raw.firstPage ?? 1; r.pageSize = rowsPerPage(raw.pageSize);
    if (!Number.isSafeInteger(r.firstPage) || r.firstPage < 1 || r.firstPage > 1000000) throw Error('Invalid Library scan count.');
    const codes = new Set(['page-failed','item-unresolved','duplicate-conflict','pagination-loop','pagination-inconsistent','request-bound','unsupported-parent']);
    if (!Array.isArray(raw.failures) || raw.failures.length > 20 || raw.failures.some(v => !codes.has(v))) throw Error('Invalid Library failure code.');
    r.failures = [...new Set(raw.failures)];
    if (r.pagesRead > MAX_PAGES || r.verifiedItems > r.pagesRead * r.pageSize || r.conflictingItems > r.unresolvedItems || (r.failures.length || r.unresolvedItems) && r.acquisition !== 'partial'
      || r.coverage === 'accessible-pages-traversed' && (r.firstPage !== 1 || r.pagesRead !== r.reportedPages || r.acquisition !== 'finished')
      || r.coverage === 'bounded' && (r.firstPage === 1 ? r.pagesRead >= r.reportedPages : r.firstPage - 1 + r.pagesRead > r.reportedPages)
      || r.acquisition === 'partial' && r.coverage !== 'incomplete') throw Error('Contradictory Library scan evidence.');
    return r;
  }
  // Resumable sync checkpoint. Page position is progress, never proof that earlier
  // entitlements were all observed; coverage never grants deletion authority.
  function checkpoint(raw) {
    if (raw == null) return null;
    if (!object(raw) || raw.version !== 1 || !uuid(raw.id) || !['full','refresh'].includes(raw.mode) || !SYNC_STATUSES.includes(raw.status)
      || raw.reason !== null && !SYNC_REASONS.includes(raw.reason) || !['in-progress','accessible-pages-traversed','recent-pages','incomplete'].includes(raw.coverage)) throw Error('Invalid Library sync checkpoint.');
    const r = { version: 1, id: raw.id, mode: raw.mode, status: raw.status, reason: raw.reason, coverage: raw.coverage, historicalComplete: false, reconciliationAuthority: 'none',
      startedAt: date(raw.startedAt).value, updatedAt: date(raw.updatedAt).value, lastProgressAt: raw.lastProgressAt === null ? null : date(raw.lastProgressAt).value };
    if (!r.startedAt || !r.updatedAt || r.lastProgressAt === undefined) throw Error('Invalid Library sync checkpoint.');
    for (const k of ['revision','nextPage','targetPages','reportedPages','reportedTotal','initialTotal','pagesRead','batches','added','refreshed','unresolved','conflicts','duplicates']) r[k] = count(raw[k]);
    r.baselineTotal = raw.baselineTotal === null ? null : count(raw.baselineTotal); r.pageSize = rowsPerPage(raw.pageSize);
    if (!Array.isArray(raw.uncertainty) || raw.uncertainty.some(v => !UNCERTAINTY.includes(v))) throw Error('Invalid Library sync checkpoint.');
    r.uncertainty = [...new Set(raw.uncertainty)];
    if (raw.lastSignature !== null && (!Array.isArray(raw.lastSignature) || raw.lastSignature.length > 5 || raw.lastSignature.some(v => !Array.isArray(v) || v.length !== 2))) throw Error('Invalid Library sync checkpoint.');
    r.lastSignature = raw.lastSignature && raw.lastSignature.map(([n, t]) => [id(n), enumeration(t)]);
    if (raw.lastFull !== null && (!object(raw.lastFull) || !['accessible-pages-traversed','incomplete'].includes(raw.lastFull.coverage))) throw Error('Invalid Library sync checkpoint.');
    r.lastFull = raw.lastFull && { completedAt: date(raw.lastFull.completedAt).value, coverage: raw.lastFull.coverage, reportedTotal: count(raw.lastFull.reportedTotal) };
    if (r.lastFull && !r.lastFull.completedAt) throw Error('Invalid Library sync checkpoint.');
    const unfinished = ['running','paused'].includes(r.status);
    if (r.revision < 1 || r.nextPage < 1 || ['running','completed'].includes(r.status) !== (r.reason === null)
      || r.status === 'completed' && (r.nextPage <= r.targetPages || r.coverage === 'in-progress') || unfinished !== (r.coverage === 'in-progress')
      || r.coverage === 'accessible-pages-traversed' && (r.mode !== 'full' || r.uncertainty.length) || r.coverage === 'recent-pages' && r.mode !== 'refresh'
      || r.mode === 'refresh' && r.targetPages > MAX_REFRESH_PAGES || r.pageSize !== LEGACY_PAGE_SIZE && r.pageSize !== PAGE_SIZES[r.mode]) throw Error('Contradictory Library sync checkpoint.');
    return r;
  }
  // Validates a batch request against the stored checkpoint and the tab's lease.
  function syncBegin(q, cp, lease) {
    if (!object(q) || !uuid(q.id) || !uuid(q.lease) || !Number.isSafeInteger(q.revision) || q.revision < 0 || !Number.isSafeInteger(q.startPage) || q.startPage < 1
      || !['full','refresh'].includes(q.mode) || typeof q.claim !== 'boolean' || (q.revision === 0 ? ![PAGE_SIZES[q.mode], LEGACY_PAGE_SIZE].includes(q.pageSize) : rowsPerPage(q.pageSize) !== cp?.pageSize)) throw Error('Invalid Library sync request.');
    const superseded = () => Error('Library sync superseded by another tab, account change, clear or restore.');
    if (!q.claim && (lease?.id !== q.lease || lease?.syncId !== q.id)) throw superseded();
    if (q.revision === 0) {
      if (q.startPage !== 1 || cp?.id === q.id || q.mode === 'refresh' && (!Number.isInteger(q.targetPages) || q.targetPages < 1 || q.targetPages > MAX_REFRESH_PAGES)) throw Error('Invalid Library sync request.');
      if (q.claim && cp && ['running','paused','stopped'].includes(cp.status) && q.replace !== true) throw Error('An unfinished Library sync exists. Resume or cancel it first.');
      return { id: q.id, revision: 0, mode: q.mode, startPage: 1, targetPages: q.mode === 'refresh' ? q.targetPages : 0, lease: q.lease, pageSize: q.pageSize };
    }
    if (!cp || cp.id !== q.id || cp.revision !== q.revision || cp.nextPage !== q.startPage || cp.mode !== q.mode || !(q.claim ? ['running','paused','stopped'] : ['running']).includes(cp.status)) throw superseded();
    return { id: q.id, revision: q.revision, mode: q.mode, startPage: q.startPage, targetPages: cp.targetPages, lease: q.lease, pageSize: cp.pageSize };
  }
  // Worker-side checkpoint advance. Counters come from validated scan/upsert results;
  // caller-supplied evidence can only add uncertainty, never remove it.
  function advance({ previous, carried, run, scan: s, request: q, added, refreshed, observed, at }) {
    if (!object(q) || !['running','paused','cancelled','stopped'].includes(q.status) || s.firstPage !== run.startPage || s.pageSize !== run.pageSize || q.nextPage !== s.firstPage + s.pagesRead
      || q.reason !== null && !SYNC_REASONS.includes(q.reason) || typeof q.orderingChanged !== 'boolean' || !Array.isArray(q.uncertainty) || q.uncertainty.some(v => !UNCERTAINTY.includes(v))) throw Error('Invalid Library sync progress.');
    const uncertainty = new Set([...(previous?.uncertainty ?? []), ...q.uncertainty]), known = s.reportedPages > 0;
    if (q.orderingChanged) uncertainty.add('ordering-changed');
    if (s.unresolvedItems) uncertainty.add('items-unresolved');
    if (s.conflictingItems) uncertainty.add('duplicate-conflict');
    if (s.failures.includes('pagination-loop')) uncertainty.add('pagination-loop');
    if (s.failures.includes('pagination-inconsistent') || known && previous?.reportedTotal && previous.reportedTotal !== s.reportedTotal) uncertainty.add('totals-changed');
    const reportedPages = known ? s.reportedPages : previous?.reportedPages ?? 0, reportedTotal = known ? s.reportedTotal : previous?.reportedTotal ?? 0;
    const baselineTotal = previous ? previous.baselineTotal : carried?.reportedTotal || null;
    let targetPages = reportedPages;
    if (run.mode === 'refresh') {
      // New purchases push older rows later, so widen a refresh by the observed growth (bounded).
      const growth = baselineTotal !== null && reportedTotal > baselineTotal ? Math.ceil((reportedTotal - baselineTotal) / run.pageSize) + 2 : 0;
      targetPages = Math.min(MAX_REFRESH_PAGES, Math.max(previous?.targetPages ?? run.targetPages, growth));
      if (known) targetPages = Math.min(targetPages, reportedPages);
    }
    const completed = reportedPages > 0 && q.nextPage > targetPages, status = completed ? 'completed' : q.status;
    // Humble can repeat a row across a page boundary and skip another. A full pass that
    // observed fewer distinct rows than Humble reports did not see every row.
    if (completed && run.mode === 'full' && observed !== undefined && count(observed) + (previous?.unresolved ?? 0) + s.unresolvedItems < reportedTotal) uncertainty.add('items-missed');
    const coverage = completed ? run.mode === 'refresh' ? 'recent-pages' : uncertainty.size ? 'incomplete' : 'accessible-pages-traversed' : ['running','paused'].includes(status) ? 'in-progress' : 'incomplete';
    return checkpoint({ version: 1, id: run.id, mode: run.mode, status, reason: completed || status === 'running' ? null : q.reason ?? 'user', coverage,
      startedAt: previous?.startedAt ?? run.startedAt, updatedAt: at, lastProgressAt: s.pagesRead ? at : previous?.lastProgressAt ?? null,
      revision: (previous?.revision ?? 0) + 1, pageSize: run.pageSize, nextPage: q.nextPage, targetPages, reportedPages, reportedTotal, initialTotal: previous?.initialTotal || reportedTotal, baselineTotal,
      pagesRead: (previous?.pagesRead ?? 0) + s.pagesRead, batches: (previous?.batches ?? 0) + 1, added: (previous?.added ?? 0) + added, refreshed: (previous?.refreshed ?? 0) + refreshed,
      unresolved: (previous?.unresolved ?? 0) + s.unresolvedItems, conflicts: (previous?.conflicts ?? 0) + s.conflictingItems, duplicates: (previous?.duplicates ?? 0) + s.duplicateItems,
      uncertainty: [...uncertainty], lastSignature: s.pagesRead ? q.signature : previous?.lastSignature ?? null,
      lastFull: completed && run.mode === 'full' ? { completedAt: at, coverage, reportedTotal } : previous?.lastFull ?? carried?.lastFull ?? null });
  }
  // Local status changes (pause/cancel/stop) without new observations.
  function settle(cp, status, reason, at) {
    return checkpoint({ ...cp, status, reason: status === 'cancelled' ? 'user' : reason ?? 'user', coverage: status === 'paused' ? 'in-progress' : 'incomplete', updatedAt: at, revision: cp.revision + 1 });
  }
  // Order History evidence. The Library has no purchase dates; Humble's Order History lists completed orders
  // with bundle-line names and transaction times, but no identifier shared with the Library. Each order line
  // read for an account is kept (by order and line ID) so dates can be matched again as Humble migrates
  // older orders and as the Library grows. Lines are evidence only, never purchase records; an order missing
  // from a later read removes nothing.
  // Page bounds: a recent check reads the newest orders; a full sync one batch; a refresh several batches.
  const ORDER_LINES = 20000, ORDER_PAGES_PER_SYNC = 20, RECENT_ORDER_PAGES = 3, ORDER_PAGES_PER_BATCH = 10, ORDER_PAGES_PER_REFRESH = 200;
  const orderTime = v => { try { return date(typeof v === 'string' ? v.replace(/(\.\d{3})\d+/u, '$1') : v).value; } catch { return null; } };
  function orderHistory(raw) {
    if (!object(raw)) return null;
    const lines = {};
    if (object(raw.lines)) for (const [ref, v] of Object.entries(raw.lines).slice(0, ORDER_LINES)) {
      try { if (ref.length <= 400 && object(v)) lines[ref] = { name: text(v.name, 400), at: v.at === null ? null : orderTime(v.at) }; } catch {}
    }
    const page = raw.resume?.page;
    return { lines, newest: orderTime(raw.newest ?? null), checkedAt: orderTime(raw.checkedAt ?? null),
      resume: Number.isSafeInteger(page) && page > 1 && page <= 100000 ? { page, newest: orderTime(raw.resume.newest ?? null) } : null };
  }
  // Library and Order History names compared without case, punctuation or "&"/"and" differences.
  const nameKey = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[‘’“”'"`]/gu, '').replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Purchase dates for a scope's Library purchases, matched by name. A purchase gets a date when its name is
  // shared by as many order lines as Library purchases and every one of those lines has the same date: one
  // purchase and one order in the normal case. Repeat purchases with different dates, or more or fewer lines
  // than purchases (Order History is still incomplete), stay undated.
  function orderDates(scope) {
    const dates = new Map();
    if (!scope?.orders) return dates;
    const lines = new Map(), parents = new Map();
    for (const line of Object.values(scope.orders.lines)) { const k = nameKey(line.name); if (k) { if (!lines.has(k)) lines.set(k, []); lines.get(k).push(line.at); } }
    for (const r of scope.observations) {
      const k = nameKey(r.parentTitle);
      if (!k) continue;
      if (!parents.has(k)) parents.set(k, new Set());
      parents.get(k).add(r.parentId);
    }
    for (const [k, ids] of parents) {
      const at = lines.get(k);
      if (!at || at.length !== ids.size || new Set(at).size !== 1 || !at[0]) continue;
      for (const parent of ids) dates.set(parent, { purchasedAt: at[0], source: 'order-history' });
    }
    return dates;
  }
  // Reads Order History pages for a synced account, newest order first.
  // - A recent read (Check recent purchases) starts at page one and stops at the first order created no later
  //   than the newest one seen before: new purchases appear at the top. It never moves the resume position.
  // - A full read (Refresh purchase dates, Sync full Library) reads every page and never stops at known orders,
  //   because Humble restores migrated orders anywhere in the list. It reads at most maxPages pages and
  //   records where to resume; the next full read continues there. Page numbers are positions, not
  //   identities: orders inserted above the resume page while a read is unfinished push later orders down,
  //   so some are read twice and none below are skipped; the inserted orders themselves are read by the
  //   next full read, which starts again at page one.
  // Every order must belong to the signed-in account the Library sync verified. The transaction time is
  // legacyCreatedAt for migrated orders (their createdAt is the migration), else completedAt, else createdAt
  // for orders placed on the new store.
  async function readOrderHistory({ fetcher, scope, state = null, full = false, maxPages = ORDER_PAGES_PER_SYNC, shouldStop = () => false }) {
    const start = full ? state?.resume?.page ?? 1 : 1, watermark = full ? null : state?.newest ?? null, lines = [], orders = new Set();
    const pick = v => typeof v === 'string' ? v : object(v) ? v['en-US'] ?? v.en ?? Object.values(v).find(x => typeof x === 'string') ?? null : null;
    const foreign = () => Object.assign(Error('Order History belongs to a different Humble account.'), { fatalScope: true });
    let newest = start > 1 ? state.resume.newest : null, total = start, page = start, done = false;
    for (let pages = 0; page <= total && pages < maxPages && !done && !shouldStop(); page++, pages++) {
      const f = await read(fetcher, '/home/purchases?page=' + page, { sameRoute: true, headers: { RSC: '1', Accept: 'text/x-component' } });
      // Signed out, Humble answers with the page shell: an AuthProvider without a user and no Order History.
      const users = f.components.filter(c => c.name === 'AuthProvider').map(c => f.resolve(c.props?.user));
      if (!users.length) throw Object.assign(Error('Unreadable Order History.'), { unexpected: true });
      if (users.every(u => !u?.id)) throw Object.assign(Error('Sign in to Humble again; saved records were kept.'), { fatalScope: true, signin: true });
      if (principal(f) !== scope.principalId) throw foreign();
      const history = f.components.filter(c => c.name === 'OrderHistory');
      const data = history.length === 1 ? f.resolve(history[0].props?.data) : null, results = f.resolve(data?.results), totalPages = f.resolve(f.resolve(data?.pagination)?.totalPages);
      if (!Array.isArray(results)) throw Object.assign(Error('Unreadable Order History.'), { unexpected: true });
      total = Number.isSafeInteger(totalPages) && totalPages >= 0 ? Math.min(totalPages, 100000) : page;
      for (const value of results) {
        const o = f.resolve(value), fields = f.resolve(f.resolve(o?.custom)?.fields) ?? {};
        if (f.resolve(fields.oryIdentityId) !== scope.principalId || fields.userHubUserId !== undefined && f.resolve(fields.userHubUserId) !== scope.userId) throw foreign();
        const order = id(f.resolve(o.id)), created = orderTime(f.resolve(o.createdAt));
        orders.add(order);
        if (start === 1 && page === 1 && created && (!newest || created > newest)) newest = created;
        if (watermark && created && created <= watermark) done = true;
        const complete = f.resolve(o.orderState) === 'Complete' && f.resolve(o.paymentState) === 'Paid';
        const legacy = ['legacyCreatedAt', 'legacyOrderId', 'sourceSystem'].some(k => f.resolve(fields[k]) != null);
        const at = orderTime(f.resolve(fields.legacyCreatedAt)) ?? orderTime(f.resolve(o.completedAt)) ?? (legacy ? null : created);
        const items = f.resolve(o.lineItems);
        for (const line of Array.isArray(items) ? items.map(f.resolve) : []) {
          const ref = order + ':' + id(f.resolve(line?.id)), name = pick(f.resolve(line?.name));
          // A cancelled or refunded order is not a purchase; a line seen that way is withdrawn.
          if (!complete) lines.push({ ref, order, drop: true });
          else if (typeof name === 'string' && name.trim()) lines.push({ ref, order, name: providerTitle(name), at });
        }
      }
    }
    const finished = done || page > total, latest = [newest, state?.newest].filter(Boolean).sort().at(-1) ?? null;
    return { lines, orders: [...orders], finished, state: {
      newest: finished ? latest : state?.newest ?? null,
      resume: full ? finished ? null : { page, newest } : state?.resume ?? null } };
  }
  function collection(raw = { version: 1, scopes: [] }) {
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.scopes) || raw.scopes.length > 100) throw Error('Invalid Library observation collection.');
    let count = 0; const seenScopes = new Set(), bindings = new Set();
    return { version: 1, scopes: raw.scopes.map(s => {
      if (!object(s) || !Array.isArray(s.observations) || typeof s.localAccountId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(s.localAccountId)) throw Error('Invalid Library account binding.');
      const scope = { principalId: id(s.principalId), userId: id(s.userId) }, key = scopeKey(scope);
      if (seenScopes.has(key)) throw Error('Duplicate Library account scope.'); seenScopes.add(key);
      const binding = JSON.stringify([s.localAccountId,s.localAccountId === null ? s.profileLabel : '']);
      if (bindings.has(binding)) throw Error('Conflicting Library account binding.'); bindings.add(binding);
      const seen = new Set(), observations = s.observations.map(value => {
        const r = observation(value), ref = identity(r);
        if (scopeKey(r.scope) !== key || seen.has(ref) || ++count > MAX_RECORDS) throw Error('Conflicting Library identity.');
        seen.add(ref); return r;
      });
      if (typeof s.profileLabel !== 'string' || s.profileLabel.length > 100) throw Error('Invalid Library profile label.');
      const orders = orderHistory(s.orders);
      return { ...scope, localAccountId: s.localAccountId, profileLabel: s.profileLabel, observations, lastScan: scan(s.lastScan), sync: checkpoint(s.sync), ...(orders ? { orders } : {}) };
    }) };
  }
  // Bundle-page matching records for the active account. A title the account's imported
  // purchases already list is matched through that record, so synced copies never double it.
  function matchingItems(state) {
    if (!ENABLED) return [];
    const result = [], seen = new Map(), kinds = historicalKinds([...(state.libraryItems ?? []), ...(state.historicalLibraryItems ?? [])]);
    const imported = new Set((state.libraryItems ?? []).map(item => JSON.stringify([titleKey(item?.title), family(item?.kind || 'book')])));
    for (const s of collection(state.libraryEntitlements).scopes) {
      if (s.localAccountId !== (state.humbleAccountId ?? null) || s.localAccountId === null && (s.profileLabel !== (state.humbleProfileLabel ?? '') || state.libraryItems?.length)) continue;
      for (const r of s.observations) {
        const kind = resolvedMedia(r, kinds);
        if (r.admission === 'observation-only' || kind === 'unknown' || imported.has(JSON.stringify([titleKey(r.title), family(kind)]))) continue;
        // Presentation-only grouping. Native observations/copies are never merged in storage.
        const key = JSON.stringify([kind, r.title, r.namespace]);
        if (seen.has(key)) { seen.get(key).libraryObservationRefs.push(identity(r)); continue; }
        const item = { title: r.title, kind, source: 'humble', itemRef: identity(r),
          entitlement: r.namespace === 'download_drm_free' ? 'direct-download' : 'third-party-key', keyStatus: 'unknown',
          libraryObservation: true, libraryObservationRefs: [identity(r)], observationSource: r.source };
        seen.set(key, item); result.push(item);
      }
    }
    return result;
  }
  const SHARED_PREFIX = 'humble-library:';
  const sharedRecord = id => typeof id === 'string' && id.startsWith(SHARED_PREFIX);
  const KEY_TYPES = { steam: 'Steam', gog: 'GOG', epic_keyless: 'Epic Games', origin: 'EA', uplay: 'Ubisoft', rockstar_social: 'Rockstar', playstation: 'PlayStation', nintendo: 'Nintendo', xbox: 'Xbox' };
  // Purchase-sync records for one saved account (the existing companion snapshot, v1).
  // Records carry the native entitlement and parent IDs, never the provider account IDs.
  // A title the account's imported purchases already share is sent only for copies beyond
  // the imported purchase count: repeat purchases stay distinct and overlap is not doubled.
  // No historical/native identity is inferred or stored.
  function companionRecords({ libraryEntitlements, accountId, items = [], historicalItems = [] }) {
    const empty = { records: [], unknown: 0, represented: 0, video: 0 };
    if (!ENABLED || typeof accountId !== 'string' || !accountId) return empty;
    const scope = collection(libraryEntitlements ?? undefined).scopes.find(s => s.localAccountId === accountId);
    if (!scope) return empty;
    const kinds = historicalKinds([...items, ...historicalItems]), copies = new Map();
    for (const item of items) {
      const k = JSON.stringify([titleKey(item?.title), family(item?.kind || 'book')]);
      const purchases = new Set((item?.provenance?.length ? item.provenance : [item]).map(p => p?.purchaseKey).filter(Boolean));
      copies.set(k, (copies.get(k) ?? 0) + Math.max(1, purchases.size));
    }
    const groups = new Map();let unknown = 0, video = 0;
    for (const r of scope.observations) {
      if (r.purchaseStatus !== 'purchased') continue;
      const kind = resolvedMedia(r, kinds);
      if (kind === 'unknown' || kind === 'unclassified') { unknown++; continue; }
      if (kind === 'video') { video++; continue; }
      const k = JSON.stringify([titleKey(r.title), family(kind)]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ r, kind });
    }
    const records = [];let represented = 0;
    for (const [k, list] of groups) {
      list.sort((a, b) => a.r.nativeId < b.r.nativeId ? -1 : a.r.nativeId > b.r.nativeId ? 1 : a.r.namespace < b.r.namespace ? -1 : 1);
      const skip = Math.min(list.length, copies.get(k) ?? 0);represented += skip;
      for (const { r, kind } of list.slice(skip)) {
        const key = r.namespace !== 'download_drm_free';
        records.push({ providerItemId: SHARED_PREFIX + r.namespace + ':' + r.nativeId, title: r.title, mediaType: family(kind),
          metadata: { purchaseId: SHARED_PREFIX + r.parentId, ...(r.parentTitle ? { sourceBundle: r.parentTitle } : {}),
            entitlement: key ? 'third-party-key' : 'direct-download', ...(key ? { keyStatus: 'unknown', ...(KEY_TYPES[r.namespace] ? { keyType: KEY_TYPES[r.namespace] } : {}) } : {}),
            ...(r.delivery?.formats?.length ? { formats: r.delivery.formats } : {}) },
          purchasedAt: null, origins: [] });
      }
    }
    return { records, unknown, represented, video };
  }
  // Future capability-gated channel only. Existing transaction protocols must not carry these.
  async function projectForGL(state, salt) {
    if (!ENABLED) throw Error('Library entitlement collection is not enabled.');
    text(salt, 200); const records = [];
    for (const s of collection(state.libraryEntitlements).scopes) {
      if (s.localAccountId !== (state.humbleAccountId ?? null) || s.localAccountId === null && (s.profileLabel !== (state.humbleProfileLabel ?? '') || state.libraryItems?.length)) continue;
      for (const r of s.observations) {
        const bytes = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([salt, identity(r)])));
        records.push({ itemRef: [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2,'0')).join(''), title: r.title,
          mediaType: r.mediaType, evidenceSource: r.source, admission: r.admission, purchaseStatus: r.purchaseStatus, activationStatus: 'unknown', observedAt: r.observedAt });
      }
    }
    return { format: 'humble-library-entitlement-observations', version: 1, coverage: 'unverified', historicalComplete: false, records };
  }
  // Strict supported Flight subset: bytes, text lengths, model references; never eval.
  function flight(body) {
    const bytes = new TextEncoder().encode(body);
    if (bytes.length > 8 * 1024 * 1024) throw Error('Library response exceeds the safety bound.');
    const decode = new TextDecoder('utf-8', { fatal: true }), models = new Map(), modules = new Map();
    // Unrelated streamed UI and error chunks are not entitlement evidence. Keep
    // their IDs unavailable so a required account/item reference still fails.
    const unavailable = new Set(), streams = new Set();
    let p = 0, records = 0;
    while (p < bytes.length) {
      if (bytes[p] === 10) { p++; continue; }
      let colon = p; while (colon < bytes.length && colon - p < 16 && bytes[colon] !== 58) colon++;
      const key = decode.decode(bytes.subarray(p, colon));
      if (bytes[colon] !== 58 || !/^[a-f0-9]*$/u.test(key) || ++records > 20000) throw Error('Unsupported Library response framing.');
      p = colon + 1;
      if (bytes[p] === 84) {
        let comma = p + 1; while (comma < bytes.length && comma - p < 16 && bytes[comma] !== 44) comma++;
        const sizeText = decode.decode(bytes.subarray(p + 1, comma));
        if (bytes[comma] !== 44 || !/^[a-f0-9]+$/u.test(sizeText)) throw Error('Invalid Library text frame.');
        const size = parseInt(sizeText,16);
        if (comma + 1 + size > bytes.length) throw Error('Truncated Library text frame.');
        if (models.has(key) || modules.has(key) || unavailable.has(key)) throw Error('Duplicate Library frame.');
        models.set(key, decode.decode(bytes.subarray(comma + 1, comma + 1 + size))); p = comma + 1 + size; continue;
      }
      let end = p; while (end < bytes.length && bytes[end] !== 10) end++;
      if (end === bytes.length) throw Error('Truncated Library response.');
      const value = decode.decode(bytes.subarray(p,end)); p = end + 1;
      if (value === 'X' || value === 'x' || value.startsWith('E')) {
        if (models.has(key) || modules.has(key) || unavailable.has(key)) throw Error('Duplicate Library frame.');
        if (value.startsWith('E')) JSON.parse(value.slice(1));
        else streams.add(key);
        unavailable.add(key); continue;
      }
      if (value.startsWith('C')) {
        if (!streams.delete(key)) throw Error('Unexpected Library stream closure.');
        if (value.length > 1) JSON.parse(value.slice(1));
        continue;
      }
      if (streams.has(key)) { JSON.parse(value); continue; }
      if (unavailable.has(key)) throw Error('Duplicate Library frame.');
      if (value.startsWith('I')) { if (modules.has(key) || models.has(key)) throw Error('Duplicate Library module.'); modules.set(key, JSON.parse(value.slice(1))); }
      else if (/^[\[\{"ntf\d-]/u.test(value)) { if (models.has(key) || modules.has(key)) throw Error('Duplicate Library model.'); models.set(key, JSON.parse(value)); }
      else if (!/^(?:H|D|W)/u.test(value)) throw Error('Unsupported Library frame.');
    }
    if (streams.size) throw Error('Truncated Library stream.');
    const resolve = value => {
      const seen = new Set();
      for (let n = 0; n < 32; n++) {
        if (typeof value !== 'string') return value;
        if (value === '$undefined') return undefined;
        if (value.startsWith('$$')) return value.slice(1);
        if (!/^\$[a-f0-9]+$/u.test(value)) return value;
        const ref = value.slice(1); if (seen.has(ref) || !models.has(ref)) throw Error('Unresolved Library reference.');
        seen.add(ref); value = models.get(ref);
      }
      throw Error('Library reference depth exceeded.');
    };
    const components = [];
    const walk = (v, depth = 0) => {
      if (depth > 80) throw Error('Library nesting exceeded.');
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v) && v[0] === '$' && typeof v[1] === 'string' && v[1].startsWith('$L')) {
        const mod = modules.get(v[1].slice(2));
        if (mod) components.push({ name: resolve(mod.at(-1)), props: resolve(v[3]), module: mod });
      }
      for (const k of Object.keys(v)) if (!['redemptionData','signedUrls','downloads','keys','instructionsHtml','keyFormatted','gameKey','key','externalAccountName'].includes(k)) walk(v[k], depth + 1);
    };
    for (const v of models.values()) walk(v);
    return { models, modules, resolve, components };
  }
  function htmlFlight(body) {
    if (typeof body !== 'string' || new TextEncoder().encode(body).length > 8 * 1024 * 1024) throw Error('Library HTML exceeds the safety bound.');
    let frames = '', chunks = 0;
    // Read literal bootstrap data only. Never evaluate scripts or insert HTML.
    for (const script of body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/giu)) {
      const value = script[1].trim();
      if (!value.startsWith('self.__next_f.push(')) continue;
      const match = /^self\.__next_f\.push\((\[.*\])\);?$/su.exec(value);
      if (!match || ++chunks > 20000) throw Error('Unsupported Library bootstrap.');
      const chunk = JSON.parse(match[1]);
      if (!Array.isArray(chunk)) throw Error('Invalid Library bootstrap.');
      if (chunk[0] === 1) {
        if (chunk.length !== 2 || typeof chunk[1] !== 'string') throw Error('Invalid Library bootstrap data.');
        frames += chunk[1];
      }
    }
    if (!frames) throw Error('Missing Library bootstrap.');
    return flight(frames);
  }
  function principal(frame) {
    const auth = frame.components.filter(c => c.name === 'AuthProvider');
    if (!auth.length) throw Object.assign(Error('Could not verify the signed-in Library account.'), { fatalScope: true });
    let ids;
    try { ids = new Set(auth.map(c => id(frame.resolve(c.props?.user?.id)))); }
    catch { throw Object.assign(Error('Could not verify the signed-in Library account.'), { fatalScope: true }); }
    if (ids.size !== 1) throw Object.assign(Error('Conflicting Library accounts.'), { fatalScope: true });
    return [...ids][0];
  }
  function retryAfter(r) {
    const v = r.headers?.get?.('retry-after');
    if (typeof v !== 'string') return null;
    if (/^\d{1,6}$/u.test(v.trim())) return Number(v) * 1000;
    const at = /\d{4}|GMT/u.test(v) ? Date.parse(v) : NaN;
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
  }
  // Redirects are not followed by default: a redirect identifies an expired sign-in. With sameRoute, a redirect
  // that stays on the requested page is followed. Humble redirects every RSC GET that lacks Next.js's `_rsc`
  // cache key to the same URL with that key added, whether or not anyone is signed in; such a request then
  // has to check the signed-in user in the response itself. A redirect anywhere else is still a sign-in.
  async function read(fetcher, path, { sameRoute = false, ...options } = {}) {
    const action = options.method === 'POST';
    let r;
    try { r = await fetcher(path, { credentials: 'same-origin', redirect: sameRoute ? 'follow' : 'manual', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options,
      headers: { Accept: action ? 'text/x-component' : 'text/html', ...options.headers } }); }
    catch { throw Object.assign(Error('Humble Library could not be reached.'), { transient: true, network: true }); }
    const moved = sameRoute && r.redirected && (() => { try { return new URL(r.url).pathname !== new URL(path, r.url).pathname; } catch { return true; } })();
    if (moved || r.type === 'opaqueredirect' || [301,302,303,307,308,401,403].includes(r.status)) throw Object.assign(Error('Sign in to Humble again; saved records were kept.'), { fatalScope: true, signin: true });
    // The provider asked for fewer requests: stop rather than retry around it.
    if (r.status === 429 || r.status === 503 && retryAfter(r) !== null) throw Object.assign(Error('Humble asked for fewer requests.'), { rateLimited: true, retryAfter: retryAfter(r) });
    if (r.status === 408 || r.status >= 500) throw Object.assign(Error('Unreadable Library response.'), { transient: true, status: r.status });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok) throw Object.assign(Error('Unreadable Library response.'), { status: r.status });
    if (!action && /^text\/html(?:;|$)/iu.test(type)) return htmlFlight(await r.text());
    if (!/^text\/x-component(?:;|$)/iu.test(type)) throw Object.assign(Error('Unreadable Library response.'), { unexpected: true });
    return flight(await r.text());
  }
  async function envelope(fetcher) {
    const f = await read(fetcher, '/home/library'), libs = f.components.filter(c => c.name === 'UserLibrary');
    const principalId = principal(f), groups = libs.length === 1 ? f.resolve(libs[0].props?.bundleItems) : null;
    if (!Array.isArray(groups) || !groups.length || groups.length > 10000) throw Object.assign(Error('Library account scope is unavailable.'), { fatalScope: true });
    const groupMap = new Map(); let userId;
    for (const g of groups) {
      const uid = id(f.resolve(g.userId)); if (userId && uid !== userId) throw Object.assign(Error('Mixed Library accounts.'), { fatalScope: true }); userId = uid;
      const route = id(f.resolve(g.productEntitlementId ?? g.id));
      if (groupMap.has(route)) throw Error('Duplicate Library parent.');
      groupMap.set(route, enumeration(f.resolve(g.type)));
    }
    return { scope: { principalId, userId }, groupMap, module: libs[0].module, frame: f };
  }
  async function actionFromModule(fetcher, env) {
    const paths = new Set(), stack = [env.module]; let visits = 0;
    while (stack.length && ++visits < 2000) {
      const v = env.frame.resolve(stack.pop()); if (Array.isArray(v)) { stack.push(...v); continue; }
      if (typeof v !== 'string') continue;
      const path = v.startsWith('static/chunks/') ? '/_next/' + v : v.startsWith('_next/static/') ? '/' + v : /^[\w-]+\.js$/u.test(v) ? '/_next/static/chunks/' + v : v;
      if (/^\/_next\/static\/chunks\/[\w.-]+\.js(?:\?[^#]*)?$/u.test(path)) paths.add(path.split('?')[0]);
    }
    const actions = new Set();
    // HTML bootstrap modules include shared dependency chunks too. Inspect at
    // most eight, starting with the module's trailing chunks, without raising
    // the request ceiling or guessing an action when no exact export is found.
    for (const path of [...paths].slice(0,8)) {
      const r = await fetcher(path, { credentials: 'omit', signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw Error('Library frontend is unavailable.'); const source = await r.text();
      if (source.length > 2000000) throw Error('Library frontend exceeds safety bound.');
      const i = source.indexOf('"filterUserLibrary"'); if (i < 0) continue;
      const hashes = [...source.slice(Math.max(0,i - 400),i).matchAll(/"([a-f0-9]{40,64})"/gu)].map(m => m[1]);
      if (hashes.length !== 1) throw Error('Unsupported Library action.'); actions.add(hashes[0]);
    }
    if (actions.size !== 1) throw Error('Could not identify the read-only Library action.');
    return [...actions][0];
  }
  function projectChild(f, row, parent, child, scope, parentType, checkedAt) {
    const t = v => f.resolve(v), namespace = enumeration(t(child.type));
    if (id(t(row.id)) !== id(t(child.id)) || providerTitle(t(child.title)) !== row.title || enumeration(t(row.type)) !== namespace) throw Error('Library row/detail identity conflict.');
    const groups = t(parent.entitlements?.redemptionGroups);
    const integrationId = t(child.keyIntegrationId), directRedeem = boolean(t(child.directRedeem));
    const listing = row.listingEvidence.filter(c => c.id === row.id && c.type === namespace);
    const revoked = [row.revoked, ...listing.map(c=>c.revoked), accessFlag(t(parent.revoked)), accessFlag(t(child.revoked))];
    const temporary = [row.temporaryAccess, ...listing.map(c=>c.temporaryAccess), accessFlag(t(parent.temporaryAccess)), accessFlag(t(child.temporaryAccess))];
    const gifted = row.giftStatus === 'gifted' || listing.some(c=>c.giftStatus === 'gifted');
    // Display name of the account-checked parent; an unusable name never rejects the purchase.
    let parentTitle = null, evidence = null;
    try { parentTitle = providerTitle(t(parent.title)); } catch {}
    // Unreadable delivery details leave media unknown; they never reject the purchase.
    if (namespace === 'download_drm_free') try { evidence = deliveryEvidence(t, t(child.downloads)); } catch {}
    return observation({ scope, nativeId: t(child.id), namespace, title: providerTitle(t(child.title)), parentId: t(row.productEntitlementId), parentTitle, ...(evidence ? { delivery: evidence } : {}), source: 'authenticated-humble-library', observedAt: checkedAt,
      eligibility: { expired: boolean(t(child.expired)), preOrdered: boolean(t(child.preOrdered)), outOfStock: boolean(t(child.outOfStock)), redeemable: boolean(t(child.redeemable)), directRedeem,
        revoked: revoked.includes(true) ? true : boolean(t(child.revoked)), temporaryAccess: temporary.includes(true) ? true : boolean(t(child.temporaryAccess)),
        parentPreOrder: boolean(t(parent.preOrder)), parentType, giftStatus: gifted ? 'gifted' : enumeration(t(child.giftStatus)),
        integration: integrationId === null && directRedeem === false ? 'none' : 'unknown',
        redemptionGroups: Array.isArray(groups) ? groups.length ? 'choices' : 'none' : 'unknown',
        unavailableBefore: date(t(child.unavailableBefore)), unavailableAfter: date(t(child.unavailableAfter)), redeemedAt: date(t(child.redeemedAt)) } });
  }
  const halts = error => error.fatalScope || error.rateLimited;
  async function collect({ fetcher = global.fetch.bind(global), store, pageLimit = 5, confirmed = false, expectedContext, progress = () => {},
    startPage = 1, overlap = null, parentLimit = MAX_PARENTS, parentCache = null, action: knownAction = null, shouldStop = () => false, sync, pageSize = LEGACY_PAGE_SIZE } = {}) {
    if (!ENABLED) throw Error('Library entitlement collection is not enabled.');
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGES || !confirmed) throw Error('Confirm the account and choose a bounded Library check.');
    if (!Number.isSafeInteger(startPage) || startPage < 1 || !Number.isInteger(parentLimit) || parentLimit < 1 || parentLimit > BATCH_ROWS || rowsPerPage(pageSize) * pageLimit > Math.max(BATCH_ROWS, MAX_PAGES * LEGACY_PAGE_SIZE)) throw Error('Choose a bounded Library check.');
    if (typeof store !== 'function') throw Error('Library storage is unavailable.');
    const context = expectedContext ?? await store('entitlementContext');
    const first = await envelope(fetcher), started = await store('entitlementBegin', { scope: first.scope, confirmed, expectedAccountId: context.accountId, expectedProfileLabel: context.profileLabel, ...(sync ? { sync } : {}) }), token = started.token;
    let finished = false;
    try {
      const action = knownAction ?? await actionFromModule(fetcher, first), rows = new Map(), seenRows = new Map(), conflicted = new Set(), parents = new Map(), pageSignatures = new Set();
      const result = { acquisition: 'finished', coverage: 'bounded', historicalComplete: false, reconciliationAuthority: 'none', checkedAt: new Date().toISOString(), firstPage: startPage, pageSize,
        pagesRead: 0, reportedTotal: 0, reportedPages: 0, verifiedItems: 0, unresolvedItems: 0, duplicateItems: 0, conflictingItems: 0, failures: [] };
      const batch = { action, pageError: null, orderingChanged: false, signature: null, requested: null };
      const fail = code => { result.acquisition = 'partial'; result.coverage = 'incomplete'; if (!result.failures.includes(code)) result.failures.push(code); };
      let parentReads = 0, totalsKnown = false;
      const requestPage = async page => {
        const body = new FormData();
        for (const [k,v] of Object.entries({ requestId: 'hcl-entitlement-' + page, query: '', sort: 'mostRecent', cursor: String(pageSize * page), page: String(page), limit: String(pageSize), hideRevealed: 'false', hideExpired: 'false', dateExpires: '' })) body.append('_1_' + k, v);
        body.append('0', JSON.stringify([{ results: [], pagination: { page: 1, totalPages: 1, totalDocs: 0 }, success: true }, '$K1']));
        const f = await read(fetcher, '/home/library', { method: 'POST', headers: { 'Next-Action': action }, body });
        const found = [...f.models.values()].filter(v => object(v) && Object.hasOwn(v,'results') && Object.hasOwn(v,'pagination'));
        if (found.length !== 1) throw Error('Unsupported Library page.');
        return { f, data: found[0] };
      };
      // Reads and validates one page; returns null after recording why the batch must stop.
      const readPage = async page => {
        let f, data;
        try { ({ f, data } = await requestPage(page)); }
        catch (error) { if (halts(error)) throw error; batch.pageError = error.transient ? 'transient' : 'incompatible'; fail('page-failed'); return null; }
        const p = data.pagination;
        if (data.success !== true || !Array.isArray(data.results) || data.results.length > pageSize || !object(p) || p.page !== page
          || !Number.isSafeInteger(p.totalPages) || p.totalPages < page || p.totalPages > 1000000 || !Number.isSafeInteger(p.totalDocs) || p.totalDocs < 0 || p.totalDocs > 1000000
          || p.totalPages !== Math.max(1,Math.ceil(p.totalDocs/pageSize)) || data.results.length !== Math.min(pageSize,Math.max(0,p.totalDocs - (page-1)*pageSize))
          || totalsKnown && (result.reportedPages !== p.totalPages || result.reportedTotal !== p.totalDocs)) { batch.pageError = 'changed'; fail('pagination-inconsistent'); return null; }
        result.reportedPages = p.totalPages; result.reportedTotal = p.totalDocs; totalsKnown = true;
        const pairs = data.results.map(r => [f.resolve(r.id),f.resolve(r.type)]), signature = JSON.stringify(pairs);
        if (data.results.length && pageSignatures.has(signature)) { batch.pageError = 'loop'; fail('pagination-loop'); return null; }
        pageSignatures.add(signature);
        let safe = null;
        // The boundary tail is enough to notice rows shifting between batches.
        try { safe = pairs.slice(-5).map(([n,t]) => [id(n), enumeration(t)]); } catch {}
        return { f, data, pairs: safe };
      };
      // Pages are not assumed stable between batches: re-read the previous batch's last
      // page and record reordering as coverage uncertainty, never as proof of absence.
      let ready = true;
      if (startPage > 1 && Array.isArray(overlap)) {
        const prior = await readPage(startPage - 1);
        if (!prior) ready = false;
        else batch.orderingChanged = JSON.stringify(prior.pairs) !== JSON.stringify(overlap);
      }
      for (let page = startPage; ready && page < startPage + pageLimit; page++) {
        const current = await readPage(page);
        if (!current) break;
        const { f, data } = current;
        // A transient parent failure rolls back the whole page so a retry re-reads it.
        const snapshot = { rows: new Map(rows), seenRows: new Map(seenRows), conflicted: new Set(conflicted), unresolvedItems: result.unresolvedItems, duplicateItems: result.duplicateItems, conflictingItems: result.conflictingItems, failures: [...result.failures], acquisition: result.acquisition, coverage: result.coverage };
        let transient = false;
        for (const raw of data.results) {
          let ref;
          try {
            if (typeof f.resolve(raw.userId) !== 'string' || f.resolve(raw.userId) !== first.scope.userId) throw Object.assign(Error('Library account changed or could not be verified.'), { fatalScope: true });
            const row = { id: id(f.resolve(raw.id)), type: enumeration(f.resolve(raw.type)), title: providerTitle(f.resolve(raw.title)), productEntitlementId: id(f.resolve(raw.productEntitlementId)) };
            row.revoked = accessFlag(f.resolve(raw.revoked)); row.temporaryAccess = accessFlag(f.resolve(raw.temporaryAccess)); row.giftStatus = enumeration(f.resolve(raw.giftStatus));
            row.listingEvidence = [...(f.resolve(raw.entitlements?.keys) ?? []), ...(f.resolve(raw.entitlements?.downloads) ?? [])].map(c => ({
              id: id(f.resolve(c.id)), type: enumeration(f.resolve(c.type)), giftStatus: enumeration(f.resolve(c.giftStatus)),
              revoked: accessFlag(f.resolve(c.revoked)), temporaryAccess: accessFlag(f.resolve(c.temporaryAccess)),
              expired: boolean(f.resolve(c.expired)), preOrdered: boolean(f.resolve(c.preOrdered)), outOfStock: boolean(f.resolve(c.outOfStock)), redeemable: boolean(f.resolve(c.redeemable)) }));
            ref = JSON.stringify([row.type,row.id]);
            const listed = first.groupMap.has(row.productEntitlementId);
            if (conflicted.has(ref)) { result.duplicateItems++; continue; }
            const previous = seenRows.get(ref);
            if (previous) {
              result.duplicateItems++;
              if (JSON.stringify(previous) !== JSON.stringify(row)) { rows.delete(ref); conflicted.add(ref); result.conflictingItems++; result.unresolvedItems++; fail('duplicate-conflict'); }
              continue;
            }
            seenRows.set(ref, row);
            let detail = parents.get(row.productEntitlementId);
            if (!detail && !parents.has(row.productEntitlementId)) {
              // Same-session reuse of an account-checked parent detail. The batch still
              // re-verifies the account before committing.
              const cached = parentCache?.get(row.productEntitlementId);
              if (cached && Date.now() - cached.at < 20 * 60 * 1000 && cached.principalId === first.scope.principalId) { detail = cached; parents.set(row.productEntitlementId, cached); }
            }
            if (!detail) {
              if (parents.has(row.productEntitlementId)) throw Error('Library parent remains unresolved.');
              if (parentReads >= parentLimit) { fail('request-bound'); throw Error('Parent bound'); }
              parentReads++; parents.set(row.productEntitlementId, null);
              const df = await read(fetcher, '/home/library/' + encodeURIComponent(row.productEntitlementId));
              if (principal(df) !== first.scope.principalId) throw Object.assign(Error('Library detail account changed.'), { fatalScope: true });
              const cs = df.components.filter(c => c.name === 'ProductKeysDownloads');
              if (cs.length !== 1 || df.resolve(cs[0].props?.productEntitlementId) !== row.productEntitlementId) throw Error('Library parent identity changed.');
              detail = { f: df, parent: df.resolve(cs[0].props.userLibraryItem) }; parents.set(row.productEntitlementId, detail);
              if (parentCache) {
                parentCache.delete(row.productEntitlementId); parentCache.set(row.productEntitlementId, { ...detail, principalId: first.scope.principalId, at: Date.now() });
                if (parentCache.size > 300) parentCache.delete(parentCache.keys().next().value);
              }
            }
            // The envelope lists bundle purchases only. Store and widget purchases are
            // verified from their own account-checked detail route, never a public product.
            const parentType = listed ? first.groupMap.get(row.productEntitlementId) : enumeration(detail.f.resolve(detail.parent.type));
            if (!listed && !DETAIL_PARENT_TYPES.has(parentType)) throw Error('Unsupported Library parent.');
            const children = [...(detail.f.resolve(detail.parent.entitlements?.keys) ?? []), ...(detail.f.resolve(detail.parent.entitlements?.downloads) ?? [])];
            if (children.length > 10000) throw Error('Excessive Library children.');
            const matches = children.filter(c => detail.f.resolve(c.id) === row.id && enumeration(detail.f.resolve(c.type)) === row.type);
            if (matches.length !== 1) throw Error('Ambiguous Library child.');
            const value = projectChild(detail.f, row, detail.parent, matches[0], first.scope, parentType, result.checkedAt);
            rows.set(ref, { row, value });
          } catch (error) { if (halts(error)) throw error; if (error.transient) { transient = true; break; } result.unresolvedItems++; fail('item-unresolved'); }
        }
        if (transient) {
          for (const [target, source] of [[rows, snapshot.rows], [seenRows, snapshot.seenRows]]) { target.clear(); for (const [k,v] of source) target.set(k,v); }
          conflicted.clear(); for (const v of snapshot.conflicted) conflicted.add(v);
          Object.assign(result, { unresolvedItems: snapshot.unresolvedItems, duplicateItems: snapshot.duplicateItems, conflictingItems: snapshot.conflictingItems, failures: snapshot.failures, acquisition: snapshot.acquisition, coverage: snapshot.coverage });
          batch.pageError = 'transient'; fail('page-failed'); break;
        }
        result.pagesRead++; batch.signature = current.pairs;
        progress({ pagesRead: result.pagesRead, verifiedItems: rows.size, unresolvedItems: result.unresolvedItems });
        if (page === result.reportedPages) { if (!result.failures.length && startPage === 1) result.coverage = 'accessible-pages-traversed'; break; }
        const stop = shouldStop();
        if (stop) { batch.requested = stop; break; }
      }
      const final = await envelope(fetcher);
      if (scopeKey(final.scope) !== scopeKey(first.scope)) throw Object.assign(Error('The Humble account changed. No observations were saved.'), { fatalScope: true });
      result.verifiedItems = rows.size;
      const progressData = sync ? { sync: { nextPage: startPage + result.pagesRead, signature: result.pagesRead ? batch.signature : null, orderingChanged: batch.orderingChanged, uncertainty: [],
        status: batch.requested ?? 'running', reason: batch.requested ? 'user' : null } } : {};
      const saved = await store('entitlementCommit', token, { scope: final.scope, observations: [...rows.values()].map(v => v.value), scan: result, ...progressData });
      finished = true; return { ...saved, batch, scope: final.scope };
    } finally { if (!finished) await store('entitlementAbort', token).catch(() => {}); }
  }
  function syncSettings(raw = {}) {
    const c = { ...SYNC_DEFAULTS, ...raw };
    if (!Number.isInteger(c.batchPages) || c.batchPages < 1 || c.batchPages > MAX_PAGES || !Number.isInteger(c.refreshPages) || c.refreshPages < 1 || c.refreshPages > MAX_REFRESH_PAGES
      || c.pageSize !== null && c.pageSize !== LEGACY_PAGE_SIZE || !(c.requestSpacingMs >= 500) || !(c.batchDelayMs >= 2000) || !Array.isArray(c.retryDelaysMs) || c.retryDelaysMs.length > 5 || c.retryDelaysMs.some(v => !(v >= 5000))
      || !Number.isInteger(c.maxSessionRequests) || c.maxSessionRequests < 1 || c.maxSessionRequests > 50000 || !(c.maxSessionMs > 0 && c.maxSessionMs <= 24 * 3600 * 1000)) throw Error('Invalid Library sync settings.');
    return c;
  }
  // Why an Order History read stopped: sign-in, another account, rate limit, network, server unavailable, or
  // an unexpected response. Unlike failureKind, unknown errors are never treated as retryable.
  function orderFailure(error) {
    return error?.signin ? 'signed-out' : error?.rateLimited ? 'rate-limited' : error?.fatalScope ? 'account'
      : error?.network ? 'network' : error?.transient ? 'unavailable' : 'unexpected';
  }
  function failureKind(error) {
    if (error?.signin) return 'signed-out';
    if (error?.rateLimited) return 'rate-limited';
    if (error?.fatalScope) return 'account';
    const message = String(error?.message ?? '');
    if (/superseded|unfinished Library sync/iu.test(message)) return 'superseded';
    if (/saved account|Humble Library belongs|different Humble Library|account changed/iu.test(message)) return 'account';
    if (/not enabled|read-only Library action|Unsupported Library action/iu.test(message)) return 'incompatible';
    return 'transient';
  }
  // User-started, tab-bound sync: bounded batches, each committed atomically with its
  // checkpoint. No timers survive the page; an interrupted sync waits for Resume.
  function createSync({ fetcher = global.fetch.bind(global), store, settings, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
    if (!ENABLED) throw Error('Library entitlement collection is not enabled.');
    if (typeof store !== 'function') throw Error('Library storage is unavailable.');
    const config = syncSettings(settings), listeners = new Set();
    let view = { phase: 'idle', mode: null, checkpoint: null, error: null, retry: null, retryAfter: null, pageRange: null }, stop = null, wake = () => {}, running = null;
    const emit = patch => { view = { ...view, ...patch }; for (const fn of listeners) { try { fn(view); } catch {} } };
    const wait = ms => new Promise(resolve => { wake = resolve; sleep(ms).then(resolve); });
    const settleRemote = async (cp, status, reason) => {
      if (!cp) return null;
      try { return await store('entitlementSync', { id: cp.id, revision: cp.revision, status, reason }); } catch { return null; }
    };
    // After a completed sync, purchase dates from Humble's Order History for the account the sync verified:
    // the newest orders after Check recent purchases, one batch of the full history after a full sync.
    // A failure here never fails the sync; the next sync looks again.
    async function datePurchases(result, mode, paced) {
      emit({ phase: 'dates', pageRange: null });
      try {
        const orders = await readOrderHistory({ fetcher: paced, scope: result.scope, state: result.orders ?? null, full: mode === 'full', maxPages: mode === 'full' ? ORDER_PAGES_PER_SYNC : RECENT_ORDER_PAGES });
        emit({ orderDates: await store('entitlementOrders', { scope: result.scope, lines: orders.lines, state: orders.state }) });
      } catch (error) { emit({ orderDates: { error: orderFailure(error), detail: String(error?.message ?? error).slice(0, 200) + (error?.status ? ` (HTTP ${error.status})` : '') } }); }
    }
    // Refresh purchase dates: the whole Order History, newest order to oldest, without reading Library pages.
    // Each batch of pages is saved with its resume position before the next is read, so a cancelled,
    // interrupted or failed refresh continues where it stopped. One run reads at most ORDER_PAGES_PER_REFRESH
    // pages; a longer history continues on the next run.
    async function refreshDatesLoop() {
      const before = await store('entitlementOrderState');
      if (!before) return emit({ phase: 'dates-done', orderDates: { error: 'not-synced' } });
      let state = before.state, pages = 0, failures = 0, last = -Infinity, dated = before.dated, newOrders = 0;
      const checked = new Set(), report = extra => ({ orders: checked.size, newOrders, dated, newlyDated: dated - before.dated, resumable: Boolean(state.resume), ...extra });
      const paced = async (path, init) => { const delay = last + config.requestSpacingMs - now(); if (delay > 0) await sleep(delay); last = now(); pages++; return fetcher(path, init); };
      while (pages < ORDER_PAGES_PER_REFRESH && !stop) {
        let read;
        try {
          read = await readOrderHistory({ fetcher: paced, scope: before.scope, state, full: true, maxPages: Math.min(ORDER_PAGES_PER_BATCH, ORDER_PAGES_PER_REFRESH - pages), shouldStop: () => stop });
        } catch (error) {
          const kind = orderFailure(error);
          // Network and server failures are retried; anything else stops with progress saved.
          if (['network', 'unavailable'].includes(kind) && ++failures <= config.retryDelaysMs.length) {
            emit({ phase: 'retrying', retry: { attempt: failures, of: config.retryDelaysMs.length, at: now() + config.retryDelaysMs[failures - 1] }, error: 'transient' });
            await wait(config.retryDelaysMs[failures - 1]); emit({ phase: 'dates', retry: null }); continue;
          }
          return emit({ phase: 'dates-done', retry: null, retryAfter: error.retryAfter ?? null,
            orderDates: report({ error: kind, detail: String(error?.message ?? error).slice(0, 200) + (error?.status ? ` (HTTP ${error.status})` : '') }) });
        }
        failures = 0;
        for (const order of read.orders) checked.add(order);
        const saved = await store('entitlementOrders', { scope: before.scope, lines: read.lines, state: read.state });
        state = read.state; dated = saved.dated; newOrders += saved.newOrders;
        emit({ orderDates: report({ running: true }) });
        if (!state.resume) break;
      }
      emit({ phase: 'dates-done', orderDates: report({ cancelled: Boolean(stop) && Boolean(state.resume) }) });
    }
    async function loop({ mode, resume, context, replace }) {
      let cp = resume, id = cp?.id ?? global.crypto.randomUUID(), revision = cp?.revision ?? 0, startPage = cp?.nextPage ?? 1, overlap = cp?.lastSignature ?? null;
      let claim = true, failures = 0, action = null, requests = 0, last = -Infinity;
      // An unfinished sync keeps the page size its checkpoint positions were counted in.
      // A pageSize setting of 5 reproduces the site's own pager.
      const pageSize = cp?.pageSize ?? config.pageSize ?? PAGE_SIZES[mode], batchLimit = Math.max(1, Math.min(config.batchPages, Math.floor(BATCH_ROWS / pageSize)));
      const lease = global.crypto.randomUUID(), began = now(), parentCache = new Map();
      // Every provider request, including parent details and assets, shares one pacing gate.
      const paced = async (path, init) => { const delay = last + config.requestSpacingMs - now(); if (delay > 0) await sleep(delay); last = now(); requests++; return fetcher(path, init); };
      const finish = (phase, patch = {}) => emit({ phase, retry: null, pageRange: null, ...patch });
      const retry = async (kind, error) => {
        const delay = config.retryDelaysMs[failures - 1];
        emit({ phase: 'retrying', retry: { attempt: failures, of: config.retryDelaysMs.length, at: now() + delay }, error: kind });
        await wait(delay);
      };
      while (true) {
        if (stop) { const saved = await settleRemote(revision ? cp : null, stop, 'user'); return finish(stop, { checkpoint: saved ?? cp, error: null }); }
        if (requests >= config.maxSessionRequests || now() - began >= config.maxSessionMs) { const saved = await settleRemote(revision ? cp : null, 'paused', 'session-limit'); return finish('paused', { checkpoint: saved ?? cp, error: 'session-limit' }); }
        const target = cp?.mode === mode && cp.targetPages || (mode === 'refresh' ? config.refreshPages : 0);
        const pageLimit = mode === 'refresh' ? Math.max(1, Math.min(batchLimit, target - startPage + 1)) : batchLimit;
        emit({ phase: 'reading', retry: null, pageRange: [startPage, startPage + pageLimit - 1], requests });
        let result;
        try {
          result = await collect({ fetcher: paced, store, confirmed: true, expectedContext: context, pageLimit, pageSize, startPage, overlap, parentLimit: pageLimit * pageSize, parentCache, action,
            shouldStop: () => stop, sync: { id, revision, mode, startPage, pageSize, lease, claim, replace: replace === true, ...(revision === 0 && mode === 'refresh' ? { targetPages: config.refreshPages } : {}) } });
        } catch (error) {
          const kind = failureKind(error);
          action = null;
          if (kind === 'transient' && ++failures <= config.retryDelaysMs.length) { await retry('transient'); continue; }
          const reason = kind === 'transient' ? 'failed' : kind;
          // A superseded tab never writes into a checkpoint it no longer owns.
          const saved = reason === 'superseded' ? null : await settleRemote(revision ? cp : null, 'stopped', reason);
          return finish('stopped', { checkpoint: saved ?? cp, error: reason, retryAfter: error.retryAfter ?? null });
        }
        claim = false; replace = false; cp = result.sync; id = cp.id; revision = cp.revision; action = result.batch.action;
        emit({ checkpoint: cp });
        if (cp.status === 'completed') await datePurchases(result, mode, paced);
        if (cp.status !== 'running') return finish(cp.status, { checkpoint: cp, error: cp.reason === 'user' ? null : cp.reason });
        const progressed = cp.nextPage > startPage;
        startPage = cp.nextPage; overlap = cp.lastSignature;
        if (!progressed) {
          action = null;
          if (++failures > config.retryDelaysMs.length) {
            const reason = result.batch.pageError === 'incompatible' ? 'incompatible' : 'failed', saved = await settleRemote(cp, 'stopped', reason);
            return finish('stopped', { checkpoint: saved ?? cp, error: reason });
          }
          await retry(result.batch.pageError === 'transient' ? 'transient' : 'changed'); continue;
        }
        failures = 0;
        emit({ phase: 'waiting', pageRange: null, requests });
        await wait(config.batchDelayMs);
      }
    }
    return {
      get view() { return view; },
      subscribe(fn) { listeners.add(fn); fn(view); return () => listeners.delete(fn); },
      active: () => Boolean(running),
      start({ mode = 'full', resume = null, context, confirmed = false, replace = false } = {}) {
        if (running) throw Error('A Library sync is already running in this tab.');
        if (confirmed !== true || !context) throw Error('Confirm the signed-in Humble account before syncing.');
        const prior = resume && checkpoint(resume);
        if (!['full','refresh'].includes(mode) || prior && prior.mode !== mode) throw Error('Invalid Library sync request.');
        stop = null;
        emit({ phase: 'starting', mode, checkpoint: prior, error: null, retry: null, retryAfter: null, orderDates: null });
        running = loop({ mode, resume: prior, context, replace })
          .catch(error => { const kind = failureKind(error); emit({ phase: 'stopped', error: kind === 'transient' ? 'failed' : kind }); })
          .finally(() => { running = null; emit({}); });
        return running;
      },
      refreshDates() {
        if (running) throw Error('A Library sync is already running in this tab.');
        stop = null;
        emit({ phase: 'dates', mode: 'dates', error: null, retry: null, retryAfter: null, pageRange: null, orderDates: { orders: 0, newOrders: 0, running: true } });
        running = refreshDatesLoop()
          .catch(() => emit({ phase: 'dates-done', orderDates: { error: 'failed' } }))
          .finally(() => { running = null; emit({}); });
        return running;
      },
      pause() { if (running && !stop) { stop = 'paused'; emit({ phase: 'pausing' }); wake(); } return running; },
      cancel() { if (running) { stop = 'cancelled'; emit({ phase: 'cancelling' }); wake(); } return running; }
    };
  }
  function syncView(state) {
    const s = collection(state.libraryEntitlements).scopes.find(v => v.localAccountId !== null && v.localAccountId === state.humbleAccountId);
    if (!s) return { checkpoint: null, saved: 0, found: 0, undetailed: 0 };
    // DRM-free purchases saved before download details were read; a full sync adds them.
    const undetailed = s.observations.filter(r => r.namespace === 'download_drm_free' && r.purchaseStatus === 'purchased' && !r.delivery).length;
    return { checkpoint: s.sync, saved: s.observations.length, found: s.sync ? s.observations.filter(r => r.observedAt >= s.sync.startedAt).length : 0, undetailed,
      orders: s.orders ? { lines: Object.keys(s.orders.lines).length, dated: orderDates(s).size, resumable: Boolean(s.orders.resume) } : null };
  }
  const UNCERTAINTY_TEXT = { 'totals-changed': 'the number of Library items changed during the sync', 'ordering-changed': 'the Library order shifted between pages',
    'items-unresolved': 'some items could not be verified', 'duplicate-conflict': 'Humble showed conflicting details for the same item', 'pagination-loop': 'Humble repeated a page', 'items-missed': 'the observed item count did not reconcile with Humble’s reported Library row count' };
  const STOP_TEXT = {
    'rate-limited': 'Humble asked for fewer requests, so the sync stopped. Progress is saved; resume later.',
    'signed-out': 'You appear to be signed out of Humble. Sign in, reload this page, then resume. Progress is saved.',
    account: 'The signed-in Humble account does not match the saved account, or it changed during the sync. Nothing from a different account was saved. Check both accounts, then resume.',
    superseded: 'This tab stopped syncing because the sync continued in another tab, or saved accounts were switched, restored or cleared. Saved progress was kept.',
    failed: 'Humble’s Library could not be read after several tries. Progress is saved; resume later.',
    incompatible: 'Humble’s Library changed in a way this version cannot read, so no further pages were read. Progress is saved.',
    'session-limit': 'Paused after a long session to keep requests to Humble modest.'
  };
  let sharedSync = null;
  // The importer section on Humble's Library page, laid out and placed like the HB and FAN purchase
  // importers: a full-width section at the top of the document, never an overlay.
  const PANEL_ID = 'hcl-library-sync';
  function installPanel({ fetcher = global.fetch.bind(global), settings } = {}) {
    if (!ENABLED || document.getElementById(PANEL_ID)) return;
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const panel = make('section', { id: PANEL_ID, className: 'hcl-importer hcl-library-sync' });
    panel.setAttribute('aria-label', 'Humble Library sync');
    const intro = make('div', { className: 'library-import-description' });
    const help = make('details'), helpText = make('p', { textContent: 'Purchased on Humble means your Humble Library lists the item as bought by this account; it does not mean a Steam or other key was activated. Gifted, revoked and temporary-access items are not counted as purchases. Items Humble shows without enough detail are not saved and can be added by a later full sync. You can pause and continue later, even after closing the browser.' });
    help.append(make('summary', { textContent: 'What the sync saves' }), helpText);
    intro.append(make('strong', { textContent: 'Humble Library Extension' }), ' ', make('span', { textContent: 'Sync your purchases from this Library page. Nothing is removed: earlier purchases, corrections and history stay as they are.' }), help);
    // First sync for a saved account binds it to the signed-in Humble account; later syncs are checked against that binding.
    const account = make('p', { className: 'hcl-sync-account' });
    const label = make('label', { className: 'hcl-sync-confirm' }), confirm = make('input', { type: 'checkbox' }), accountName = make('span');
    const labelText = make('span'); labelText.append('The Humble account signed in here is my saved account ', accountName, '.'); label.append(confirm, labelText);
    const progressRow = make('div', { className: 'hcl-sync-progress' });
    const bar = make('progress', { max: 1, value: 0 }); bar.setAttribute('aria-label', 'Library pages read');
    const summary = make('span');
    progressRow.append(bar, summary);
    const footer = make('div', { className: 'library-import-footer' }), status = make('output', { ariaLive: 'polite' });
    status.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
    const actions = make('div', { className: 'hcl-import-actions' });
    const button = (action, text) => { const b = make('button', { type: 'button', textContent: text }); b.dataset.action = action; actions.append(b); return b; };
    const startFull = button('full', 'Sync full Library'), refresh = button('refresh', 'Check recent purchases'), datesButton = button('dates', 'Refresh purchase dates'), pause = button('pause', 'Pause'), resume = button('resume', 'Resume'), cancel = button('cancel', 'Cancel'), browse = button('browse', 'Browse your library');
    browse.addEventListener('click', () => { global.chrome.runtime.sendMessage({ type: 'HCL_OPEN_OPTIONS' }).catch(() => {}); });
    footer.append(status, actions);
    const details = make('details', { className: 'hcl-sync-details' }), facts = make('ul', { className: 'hcl-sync-facts' }), note = make('p', { className: 'hcl-sync-note' });
    details.append(make('summary', { textContent: 'Scan details' }), facts, note);
    const store = (operation, ...args) => global.HumbleComicLibrary.storageRequest(operation, ...args);
    sharedSync ??= createSync({ fetcher, settings, store });
    // Nothing actionable is shown until the saved account and sync state are read, so a synced account
    // never briefly appears unsynced (with the first-sync confirmation) while storage loads.
    let context, stored = { checkpoint: null, saved: 0, found: 0, bound: false }, message = '', loaded = false, showCompleted = false;
    const number = v => v.toLocaleString(), plural = (n, one, many = one + 's') => `${number(n)} ${n === 1 ? one : many}`;
    // Purchase-date refresh messages count orders checked, orders new to the extension and Library purchases
    // dated: different things, never interchangeable.
    let undated = null;
    const datesProgressText = v => v.phase === 'cancelling' ? 'Stopping after the current Order History page… Dates already found stay saved.'
      : v.phase === 'retrying' && v.retry ? `Humble’s Order History did not respond as expected. Trying again in about ${Math.max(1, Math.round((v.retry.at - Date.now()) / 1000))} seconds. Progress so far is saved.`
      : `Checking Humble Order History for purchase dates…${v.orderDates.orders ? ` ${plural(v.orderDates.orders, 'order')} checked so far.` : ''}`;
    // A refresh that stopped says why and what to do; it never reports a check that did not happen.
    const DATE_ERRORS = {
      'signed-out': 'Humble did not show your Order History because this tab is no longer signed in. Sign in on humblebundle.com, then refresh purchase dates again.',
      account: 'The Humble account signed in here is not your saved account, so its Order History was not used and nothing was saved from it.',
      'rate-limited': 'Humble asked for fewer requests, so the purchase-date refresh stopped. Try again later.',
      network: 'Humble could not be reached, so the purchase-date refresh stopped. Check your connection and try again.',
      unavailable: 'Humble’s Order History is temporarily unavailable, so the purchase-date refresh stopped. Try again later.',
      unexpected: 'Humble’s Order History did not look as expected, so the purchase-date refresh stopped and nothing was changed from it. Try again later; if this continues, the extension may need an update.'
    };
    const datesText = o => {
      if (o.error === 'not-synced') return 'Sync your Library first: purchase dates are matched to purchases already saved.';
      const parts = [], saved = o.resumable ? 'Progress is saved: Continue refreshing purchase dates picks up where this stopped.' : '';
      if (o.error) {
        parts.push(DATE_ERRORS[o.error] ?? DATE_ERRORS.unexpected);
        if (o.orders) parts.push(`${plural(o.orders, 'order')} checked before it stopped${o.newlyDated > 0 ? `; dates recovered for ${plural(o.newlyDated, 'purchase')}` : ''}.`, saved);
        return parts.filter(Boolean).join(' ');
      }
      if (o.cancelled) parts.push('Purchase-date refresh stopped.');
      parts.push(`Checked ${plural(o.orders ?? 0, 'order')}${o.newOrders ? ` (${number(o.newOrders)} new)` : ''}.`);
      parts.push(o.newlyDated > 0 ? `Recovered dates for ${plural(o.newlyDated, 'purchase')}.` : 'No additional purchase dates found.');
      if (undated !== null && !o.resumable) parts.push(`${plural(undated, 'Library purchase')} still ${undated === 1 ? 'has' : 'have'} no purchase date.`);
      parts.push(saved || 'More older orders may become available as Humble restores its order history.');
      return parts.filter(Boolean).join(' ');
    };
    // Library purchases with no date from any source (imported order or Order History), as Bundles & Orders shows them.
    const countUndated = async () => {
      const B = global.HumbleLibraryBrowser; if (!B) return null;
      const s = await global.chrome.storage.local.get({ libraryItems: [], purchaseSummaries: [], libraryEntitlements: { version: 1, scopes: [] }, humbleAccountId: null });
      const model = B.buildGroups({ items: s.libraryItems, purchaseSummaries: s.purchaseSummaries, libraryEntitlements: s.libraryEntitlements, humbleAccountId: s.humbleAccountId });
      if (!model.native.present) return null;
      return B.reconcile(model.groups).groups.filter(g => (g.source === 'native' || g.source === 'unified') && g.items.some(i => i.source !== 'historical' && !i.excluded) && g.purchasedAt === null).length;
    };
    const render = () => {
      if (!panel.isConnected && panel.dataset.installed) return;
      if (!loaded) {
        for (const node of [account, label, progressRow, details, ...actions.children]) node.hidden = true;
        status.textContent = 'Loading your saved sync…';
        return;
      }
      const v = sharedSync.view, live = sharedSync.active(), cp = stored.checkpoint;
      if(live)showCompleted=true;
      const unfinished = !live && cp && ['running','paused','stopped'].includes(cp.status);
      startFull.hidden = live || unfinished; refresh.hidden = live || unfinished; resume.hidden = !unfinished;
      // Purchase dates refresh on their own; they need saved Library purchases to match against.
      datesButton.hidden = live || !stored.bound; datesButton.textContent = stored.orders?.resumable ? 'Continue refreshing purchase dates' : 'Refresh purchase dates';
      pause.hidden = !live || v.mode === 'dates' || ['pausing','cancelling'].includes(v.phase); cancel.hidden = !(live || unfinished) || v.phase === 'cancelling';
      startFull.textContent = cp?.lastFull ? 'Run full sync again' : 'Sync full Library';
      browse.hidden = !stored.saved || live;
      label.hidden = stored.bound; account.hidden = !stored.bound || !context;
      if (context) account.textContent = `Saved account: ${context.profileLabel ? `“${context.profileLabel}”` : 'not yet named'}. Each sync checks that the Humble account signed in here is the same one.`;
      progressRow.hidden = !cp || cp.status==='completed'&&!showCompleted || v.mode === 'dates';
      if (cp) {
        const read = Math.min(cp.nextPage - 1, cp.targetPages);
        bar.max = Math.max(1, cp.targetPages); bar.value = read;
        summary.textContent = `${cp.mode === 'refresh' ? 'Recent pages' : 'Pages'} ${number(read)} of ${number(cp.targetPages)} · ${plural(stored.found, 'item')} observed in this sync · ${plural(stored.saved, 'item')} saved`;
      }
      const media = Object.entries(stored.media ?? {}).filter(([, n]) => n).map(([k, n]) => `${k === 'unknown' ? 'unknown' : k} ${number(n)}`).join(', ');
      facts.replaceChildren(...(cp ? [
        `Pages read: ${number(Math.min(cp.nextPage - 1, cp.targetPages))} of ${number(cp.targetPages)}${cp.mode === 'refresh' ? ' recent pages' : ' that Humble reports'} (${number(cp.reportedTotal)} Library rows reported)`,
        ...(v.requests ? [`Requests to Humble in this session: ${number(v.requests)}`] : []),
        `Saved observations from this sync: ${number(stored.found)} (${number(cp.added)} new, ${number(cp.refreshed)} already saved)`,
        `Saved Library items for this account: ${number(stored.saved)}`,
        ...(stored.excluded ? [`Not counted as purchases: ${number(stored.excluded)} gifted, revoked or temporary-access item${stored.excluded === 1 ? '' : 's'}`] : []),
        ...(cp.unresolved ? [`Could not be verified: ${number(cp.unresolved)} item${cp.unresolved === 1 ? '' : 's'} (not saved; a later full sync may verify ${cp.unresolved === 1 ? 'it' : 'them'})`] : []),
        ...(media ? [`Media from Humble's download details: ${media}`] : []),
        ...(stored.undetailed ? [`Media not yet identified: ${number(stored.undetailed)} item${stored.undetailed === 1 ? '' : 's'} saved by an earlier version. Run the full sync again to identify books, comics, games and software.`] : []),
        `Coverage: ${cp.coverage === 'accessible-pages-traversed' ? 'every page Humble currently shows was read' : cp.coverage === 'recent-pages' ? 'recent pages only' : cp.coverage === 'in-progress' ? 'in progress' : 'incomplete'}`,
        ...(cp.lastProgressAt ? [`Last progress: ${new Date(cp.lastProgressAt).toLocaleString()}`] : []),
        // Purchases dated, not orders found: an order line counts only once matched to one Library purchase.
        ...(stored.orders ? [`Purchase dates from your Humble order history: ${plural(stored.orders.dated, 'Library purchase')} dated. Humble is still adding older orders there; later syncs add their dates.`] : []),
        ...(stored.orders?.resumable ? ['An earlier purchase-date refresh stopped partway; Continue refreshing purchase dates picks it up.'] : []),
        // Technical detail for a stopped purchase-date check, kept out of the main status.
        ...(v.orderDates?.detail ? [`Purchase-date check stopped: ${v.orderDates.detail}`] : []),
        ...(v.retry ? [`Retrying after a failed request: attempt ${v.retry.attempt} of ${v.retry.of}`] : []),
        ...(v.retryAfter ? [`Humble asked to wait about ${Math.max(1, Math.ceil(v.retryAfter / 60000))} minutes before more requests`] : [])
      ] : []).map(text => make('li', { textContent: text })));
      details.hidden = !cp;
      const from = cp ? ` Resume to continue from page ${number(cp.nextPage)}.` : '';
      let text;
      if (message) text = message;
      else if (live) text = { starting: 'Starting…', pausing: 'Pausing after the current page…', cancelling: 'Cancelling after the current page… Purchases already found stay saved.',
        waiting: 'Syncing… pausing briefly between pages to keep requests to Humble modest.',
        dates: 'Looking up purchase dates in your Humble order history…',
        retrying: v.retry ? `Humble did not respond as expected. Trying again in about ${Math.max(1, Math.round((v.retry.at - Date.now()) / 1000))} seconds. Progress so far is saved.` : 'Trying again…'
      }[v.phase] ?? `${v.mode === 'refresh' ? 'Checking recent purchases' : 'Syncing'}… reading pages ${number(v.pageRange?.[0] ?? 1)}–${number(v.pageRange?.[1] ?? 1)}.`;
      else if (v.phase === 'stopped' && v.error === 'superseded') text = STOP_TEXT.superseded;
      else if (!cp) text = 'Not synced in this browser yet. Start with a full sync; most Libraries take minutes.';
      else if (cp.status === 'running') text = 'The sync was interrupted (the page closed or the browser restarted).' + from + ' If it is still running in another Humble tab, resuming here stops it there.';
      else if (cp.status === 'paused') text = (cp.reason === 'session-limit' ? STOP_TEXT['session-limit'] : 'Paused.') + from;
      else if (cp.status === 'stopped') text = (STOP_TEXT[cp.reason] ?? STOP_TEXT.failed) + (v.retryAfter ? ` Humble suggested waiting about ${Math.max(1, Math.ceil(v.retryAfter / 60000))} minutes.` : '');
      else if (cp.status === 'cancelled') text = 'Sync cancelled. Purchases already found stay saved.';
      else if (!showCompleted) text = 'Ready to check for new purchases. Last sync details are available below.' + (cp.coverage==='incomplete'?' The last sync had coverage warnings; see Scan details.':'');
      else if (cp.mode === 'refresh') text = `Checked your most recent Library ${cp.targetPages === 1 ? 'page' : `${number(cp.targetPages)} pages`} for new purchases. Older pages were not checked again${cp.lastFull ? '' : '; run a full sync to check the available older pages'}.` + (cp.uncertainty.length?' Coverage warnings are listed in Scan details.':'');
      else if (cp.coverage === 'accessible-pages-traversed') text = `Finished: read all ${number(cp.reportedPages)} pages your Humble Library currently shows. This reflects what the Library shows today, not proof of your complete purchase history. Existing purchases were kept.`;
      else text = 'Finished reading the available pages. Coverage could not be confirmed; see Scan details for the observed issues. Existing purchases were kept.';
      if (!live && !message && showCompleted && cp?.status === 'completed' && v.mode !== 'dates' && v.orderDates?.error) text += ' Purchase dates could not be looked up in your Humble order history this time; the next sync tries again.';
      if (!message && v.mode === 'dates' && v.orderDates) text = live ? datesProgressText(v) : v.phase === 'dates-done' ? datesText(v.orderDates) : text;
      status.textContent = text;
      const doubts = (cp?.uncertainty ?? []).map(code => UNCERTAINTY_TEXT[code]);
      note.textContent = doubts.length ? `Why this may be incomplete: ${doubts.join('; ')}.` : '';
      note.hidden = !doubts.length;
    };
    const refreshStored = async () => {
      const state = await global.chrome.storage.local.get({ libraryEntitlements: { version: 1, scopes: [] }, humbleAccountId: null });
      const own = context && state.humbleAccountId === context.accountId;
      stored = own ? syncView(state) : { checkpoint: null, saved: 0, found: 0 };
      const scope = own ? collection(state.libraryEntitlements).scopes.find(x => x.localAccountId === context.accountId) : null;
      stored.bound = Boolean(scope);
      const views = own ? purchaseViews(state) : [];
      stored.excluded = views.filter(item => item.status !== 'Purchased').length;
      stored.media = {};
      for (const r of scope?.observations ?? []) if (r.purchaseStatus === 'purchased') stored.media[r.mediaType] = (stored.media[r.mediaType] ?? 0) + 1;
      if (context) loaded = true;
      render();
    };
    const revisit=event=>{
      if(!panel.isConnected){global.removeEventListener?.('pageshow',revisit);return;}
      if(!event.persisted)return;
      if(!sharedSync.active()&&stored.checkpoint?.status==='completed'){showCompleted=false;message='';render();}
      refreshStored().catch(render);
    };
    global.addEventListener?.('pageshow',revisit);
    let counted = null;
    const unsubscribe = sharedSync.subscribe(v => {
      if (!panel.isConnected && panel.dataset.installed) { unsubscribe?.();global.removeEventListener?.('pageshow',revisit);return; }
      message = ''; refreshStored().catch(render);
      // After a purchase-date refresh, count purchases still undated once (it reads the whole library).
      if (v.mode === 'dates' && v.phase === 'dates-done' && counted !== v.orderDates) { counted = v.orderDates; countUndated().then(n => { undated = n; render(); }, () => {}); }
    });
    const changed = (changes, area) => {
      if (!panel.isConnected) { global.chrome.storage.onChanged?.removeListener(changed);global.removeEventListener?.('pageshow',revisit);return; }
      if (area === 'local' && (changes.libraryEntitlements || changes.humbleAccountId)) refreshStored().catch(() => {});
    };
    global.chrome.storage.onChanged?.addListener(changed);
    const begin = (mode, prior) => {
      // An account already bound to a Humble Library is verified by the worker on every batch.
      if (!stored.bound && !confirm.checked) { message = 'Confirm the signed-in account first. Nothing was read or changed.'; render(); return; }
      if (!context) { message = 'Wait for the saved account to load, then try again.'; render(); return; }
      try { message = ''; showCompleted=true; sharedSync.start({ mode, resume: prior, context, confirmed: true }); }
      catch { message = 'The sync could not start. Your records are unchanged. Reload this page and try again.'; render(); }
    };
    startFull.addEventListener('click', () => begin('full', null));
    refresh.addEventListener('click', () => begin('refresh', null));
    datesButton.addEventListener('click', () => {
      if (!stored.bound) return;
      try { message = ''; undated = null; sharedSync.refreshDates(); }
      catch { message = 'The purchase-date refresh could not start. Your records are unchanged. Reload this page and try again.'; render(); }
    });
    resume.addEventListener('click', () => { const cp = stored.checkpoint; if (cp) begin(cp.mode, cp); });
    pause.addEventListener('click', () => sharedSync.pause());
    cancel.addEventListener('click', async () => {
      if (sharedSync.active()) { sharedSync.cancel(); return; }
      const cp = stored.checkpoint; if (!cp) return;
      try { await store('entitlementSync', { id: cp.id, revision: cp.revision, status: 'cancelled', reason: 'user' }); message = ''; }
      catch { message = 'The sync could not be cancelled because it changed elsewhere. Reload this page to see the current progress.'; }
      await refreshStored().catch(render);
    });
    store('entitlementContext').then(value => {
      context = value; accountName.textContent = value.profileLabel ? `“${value.profileLabel}”` : '(not yet named)';
      refreshStored().catch(() => { loaded = true; render(); });
    }, () => { loaded = true; message = 'The saved account is unavailable. Open Extension options before syncing.'; render(); });
    panel.append(intro, account, label, progressRow, footer, details);
    // Same placement as the HB and FAN importers: first in the document, above Humble's banner and header.
    document.body.prepend(panel);
    panel.dataset.installed = 'true'; render();
  }
  global.HumbleLibraryEntitlements = Object.freeze({ ENABLED, MAX_RECORDS, MAX_PAGES, MAX_REFRESH_PAGES, PAGE_SIZES, BATCH_ROWS, SYNC_DEFAULTS, collection, observation, refreshObservation, identity, scopeKey, admission, scan, checkpoint, syncBegin, advance, settle, syncSettings,
    matchingItems, companionRecords, sharedRecord, resolvedMedia, historicalKinds, providerMedia, purchaseViews, syncView, projectForGL, flight, collect, createSync, installPanel,
    orderHistory, orderDates, readOrderHistory, ORDER_PAGES_PER_SYNC });
})(globalThis);
