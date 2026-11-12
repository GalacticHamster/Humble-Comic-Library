// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
/* Independent Library observations. Never a replacement for purchase history. */
(function (global) {
  'use strict';
  const ENABLED = false; // Activation requires the documented live-validation gate.
  const MAX_RECORDS = 100000, MAX_PAGES = 10, MAX_PARENTS = 20;
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max = 500) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/u.test(v)) throw Error('Invalid Library observation text.');
    return v;
  };
  const id = v => { text(v, 250); if (v.startsWith('$')) throw Error('Unresolved Library identity.'); return v; };
  const enumeration = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(v) ? v : 'unknown';
  const boolean = v => typeof v === 'boolean' ? v : null;
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
    for (const name of ['giftStatus','parentType','integration','redemptionGroups']) result[name] = enumeration(raw[name]);
    for (const name of ['unavailableBefore','unavailableAfter','redeemedAt']) {
      const v = raw[name];
      if (!object(v) || !['unknown','none','date'].includes(v.state) || (v.state === 'date' ? typeof v.value !== 'string' || date(v.value).value !== v.value : v.value !== null)) throw Error('Invalid Library date evidence.');
      result[name] = { state: v.state, value: v.value };
    }
    return result;
  }
  function admission(r) {
    const e = r.eligibility;
    if (!['download_drm_free','steam'].includes(r.namespace)) return 'observation-only';
    if (e.parentType !== 'bundle' || e.parentPreOrder !== false || e.redemptionGroups !== 'none'
      || e.giftStatus !== 'unassigned' || e.expired !== false || e.preOrdered !== false
      || e.outOfStock !== false || e.redeemable !== true || e.unavailableBefore.state !== 'none'
      || e.unavailableAfter.state !== 'none') return 'observation-only';
    if (r.namespace === 'steam' && (e.directRedeem !== false || e.integration !== 'none')) return 'observation-only';
    return r.namespace === 'steam' ? 'humble-key-entitlement' : 'personal-drm-free-entitlement';
  }
  function observation(raw) {
    if (!object(raw) || !object(raw.scope) || raw.source !== 'authenticated-humble-library') throw Error('Invalid Library observation.');
    const r = { scope: { principalId: id(raw.scope.principalId), userId: id(raw.scope.userId) },
      namespace: enumeration(raw.namespace), nativeId: id(raw.nativeId), title: text(raw.title),
      parentId: id(raw.parentId), source: 'authenticated-humble-library', observedAt: date(raw.observedAt).value,
      eligibility: eligibility(raw.eligibility) };
    if (r.namespace === 'unknown' || !r.observedAt) throw Error('Library identity or timestamp is missing.');
    // No title-based media inference. DRM-free files may be books, games or software.
    r.mediaType = r.namespace === 'steam' ? 'game' : 'unknown';
    r.admission = admission(r); r.activationStatus = 'unknown';
    return r;
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
    const codes = new Set(['page-failed','item-unresolved','duplicate-conflict','pagination-loop','pagination-inconsistent','request-bound','unsupported-parent']);
    if (!Array.isArray(raw.failures) || raw.failures.length > 20 || raw.failures.some(v => !codes.has(v))) throw Error('Invalid Library failure code.');
    r.failures = [...new Set(raw.failures)];
    if (r.pagesRead > MAX_PAGES || r.verifiedItems > r.pagesRead * 5 || r.conflictingItems > r.unresolvedItems || (r.failures.length || r.unresolvedItems) && r.acquisition !== 'partial'
      || r.coverage === 'accessible-pages-traversed' && (r.pagesRead !== r.reportedPages || r.acquisition !== 'finished')
      || r.coverage === 'bounded' && r.pagesRead >= r.reportedPages
      || r.acquisition === 'partial' && r.coverage !== 'incomplete') throw Error('Contradictory Library scan evidence.');
    return r;
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
      return { ...scope, localAccountId: s.localAccountId, profileLabel: s.profileLabel, observations, lastScan: scan(s.lastScan) };
    }) };
  }
  function matchingItems(state) {
    if (!ENABLED) return [];
    const result = [], seen = new Map();
    for (const s of collection(state.libraryEntitlements).scopes) {
      if (s.localAccountId !== (state.humbleAccountId ?? null) || s.localAccountId === null && (s.profileLabel !== (state.humbleProfileLabel ?? '') || state.libraryItems?.length)) continue;
      for (const r of s.observations) {
        if (r.admission === 'observation-only' || r.mediaType === 'unknown') continue;
        // Presentation-only grouping. Native observations/copies are never merged in storage.
        const key = JSON.stringify([r.mediaType, r.title, r.namespace]);
        if (seen.has(key)) { seen.get(key).libraryObservationRefs.push(identity(r)); continue; }
        const item = { title: r.title, kind: r.mediaType, source: 'humble', itemRef: identity(r),
          entitlement: r.namespace === 'steam' ? 'third-party-key' : 'direct-download', keyStatus: 'unknown',
          libraryObservation: true, libraryObservationRefs: [identity(r)], observationSource: r.source };
        seen.set(key, item); result.push(item);
      }
    }
    return result;
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
          mediaType: r.mediaType, evidenceSource: r.source, admission: r.admission, activationStatus: 'unknown', observedAt: r.observedAt });
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
  async function read(fetcher, path, options = {}) {
    const action = options.method === 'POST';
    const r = await fetcher(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options,
      headers: { Accept: action ? 'text/x-component' : 'text/html', ...options.headers } });
    if ([401,403].includes(r.status)) throw Object.assign(Error('Sign in to Humble again; saved records were kept.'), { fatalScope: true });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok) throw Error('Unreadable Library response.');
    if (!action && /^text\/html(?:;|$)/iu.test(type)) return htmlFlight(await r.text());
    if (!/^text\/x-component(?:;|$)/iu.test(type)) throw Error('Unreadable Library response.');
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
    if (id(t(row.id)) !== id(t(child.id)) || t(child.title) !== t(row.title) || enumeration(t(row.type)) !== namespace) throw Error('Library row/detail identity conflict.');
    const groups = t(parent.entitlements?.redemptionGroups);
    const integrationId = t(child.keyIntegrationId), directRedeem = boolean(t(child.directRedeem));
    return observation({ scope, nativeId: t(child.id), namespace, title: t(child.title), parentId: t(row.productEntitlementId), source: 'authenticated-humble-library', observedAt: checkedAt,
      eligibility: { expired: boolean(t(child.expired)), preOrdered: boolean(t(child.preOrdered)), outOfStock: boolean(t(child.outOfStock)), redeemable: boolean(t(child.redeemable)), directRedeem,
        parentPreOrder: boolean(t(parent.preOrder)), parentType, giftStatus: enumeration(t(child.giftStatus)),
        integration: integrationId === null && directRedeem === false ? 'none' : 'unknown',
        redemptionGroups: Array.isArray(groups) ? groups.length ? 'choices' : 'none' : 'unknown',
        unavailableBefore: date(t(child.unavailableBefore)), unavailableAfter: date(t(child.unavailableAfter)), redeemedAt: date(t(child.redeemedAt)) } });
  }
  async function collect({ fetcher = global.fetch.bind(global), store, pageLimit = 5, confirmed = false, expectedContext, progress = () => {} } = {}) {
    if (!ENABLED) throw Error('Library entitlement collection is not enabled.');
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGES || !confirmed) throw Error('Confirm the account and choose a bounded Library check.');
    if (typeof store !== 'function') throw Error('Library storage is unavailable.');
    const context = expectedContext ?? await store('entitlementContext');
    const first = await envelope(fetcher), started = await store('entitlementBegin', { scope: first.scope, confirmed, expectedAccountId: context.accountId, expectedProfileLabel: context.profileLabel }), token = started.token;
    let finished = false;
    try {
      const action = await actionFromModule(fetcher, first), rows = new Map(), seenRows = new Map(), conflicted = new Set(), parents = new Map(), pageSignatures = new Set();
      const result = { acquisition: 'finished', coverage: 'bounded', historicalComplete: false, reconciliationAuthority: 'none', checkedAt: new Date().toISOString(),
        pagesRead: 0, reportedTotal: 0, reportedPages: 0, verifiedItems: 0, unresolvedItems: 0, duplicateItems: 0, conflictingItems: 0, failures: [] };
      const fail = code => { result.acquisition = 'partial'; result.coverage = 'incomplete'; if (!result.failures.includes(code)) result.failures.push(code); };
      for (let page = 1; page <= pageLimit; page++) {
        let f, data;
        try {
          const body = new FormData();
          for (const [k,v] of Object.entries({ requestId: 'hcl-entitlement-' + page, query: '', sort: 'mostRecent', cursor: String(5 * page), page: String(page), limit: '5', hideRevealed: 'false', hideExpired: 'false', dateExpires: '' })) body.append('_1_' + k, v);
          body.append('0', JSON.stringify([{ results: [], pagination: { page: 1, totalPages: 1, totalDocs: 0 }, success: true }, '$K1']));
          f = await read(fetcher, '/home/library', { method: 'POST', headers: { 'Next-Action': action }, body });
          const found = [...f.models.values()].filter(v => object(v) && Object.hasOwn(v,'results') && Object.hasOwn(v,'pagination'));
          if (found.length !== 1) throw Error('Unsupported Library page.'); data = found[0];
          const p = data.pagination;
          if (data.success !== true || !Array.isArray(data.results) || data.results.length > 5 || !object(p) || p.page !== page
            || !Number.isSafeInteger(p.totalPages) || p.totalPages < page || p.totalPages > 1000000 || !Number.isSafeInteger(p.totalDocs) || p.totalDocs < 0 || p.totalDocs > 1000000
            || p.totalPages !== Math.max(1,Math.ceil(p.totalDocs/5)) || data.results.length !== Math.min(5,Math.max(0,p.totalDocs - (page-1)*5))) { fail('pagination-inconsistent'); break; }
          if (page > 1 && (result.reportedPages !== p.totalPages || result.reportedTotal !== p.totalDocs)) { fail('pagination-inconsistent'); break; }
          result.reportedPages = p.totalPages; result.reportedTotal = p.totalDocs;
          const signature = JSON.stringify(data.results.map(r => [f.resolve(r.id),f.resolve(r.type)]));
          if (data.results.length && pageSignatures.has(signature)) { fail('pagination-loop'); break; } pageSignatures.add(signature);
        } catch (error) { if (error.fatalScope) throw error; fail('page-failed'); break; }
        result.pagesRead++;
        for (const raw of data.results) {
          let ref;
          try {
            if (typeof f.resolve(raw.userId) !== 'string' || f.resolve(raw.userId) !== first.scope.userId) throw Object.assign(Error('Library account changed or could not be verified.'), { fatalScope: true });
            const row = { id: id(f.resolve(raw.id)), type: enumeration(f.resolve(raw.type)), title: text(f.resolve(raw.title)), productEntitlementId: id(f.resolve(raw.productEntitlementId)) };
            row.listingEvidence = [...(f.resolve(raw.entitlements?.keys) ?? []), ...(f.resolve(raw.entitlements?.downloads) ?? [])].map(c => ({
              id: id(f.resolve(c.id)), type: enumeration(f.resolve(c.type)), giftStatus: enumeration(f.resolve(c.giftStatus)),
              expired: boolean(f.resolve(c.expired)), preOrdered: boolean(f.resolve(c.preOrdered)), outOfStock: boolean(f.resolve(c.outOfStock)), redeemable: boolean(f.resolve(c.redeemable)) }));
            ref = JSON.stringify([row.type,row.id]);
            if (!first.groupMap.has(row.productEntitlementId)) throw Error('Unsupported Library parent.');
            if (conflicted.has(ref)) { result.duplicateItems++; continue; }
            const previous = seenRows.get(ref);
            if (previous) {
              result.duplicateItems++;
              if (JSON.stringify(previous) !== JSON.stringify(row)) { rows.delete(ref); conflicted.add(ref); result.conflictingItems++; result.unresolvedItems++; fail('duplicate-conflict'); }
              continue;
            }
            seenRows.set(ref, row);
            let detail = parents.get(row.productEntitlementId);
            if (!detail) {
              if (parents.has(row.productEntitlementId)) throw Error('Library parent remains unresolved.');
              if (parents.size >= MAX_PARENTS) { fail('request-bound'); throw Error('Parent bound'); }
              parents.set(row.productEntitlementId, null);
              const df = await read(fetcher, '/home/library/' + encodeURIComponent(row.productEntitlementId));
              if (principal(df) !== first.scope.principalId) throw Object.assign(Error('Library detail account changed.'), { fatalScope: true });
              const cs = df.components.filter(c => c.name === 'ProductKeysDownloads');
              if (cs.length !== 1 || df.resolve(cs[0].props?.productEntitlementId) !== row.productEntitlementId) throw Error('Library parent identity changed.');
              detail = { f: df, parent: df.resolve(cs[0].props.userLibraryItem) }; parents.set(row.productEntitlementId, detail);
            }
            const children = [...(detail.f.resolve(detail.parent.entitlements?.keys) ?? []), ...(detail.f.resolve(detail.parent.entitlements?.downloads) ?? [])];
            if (children.length > 10000) throw Error('Excessive Library children.');
            const matches = children.filter(c => detail.f.resolve(c.id) === row.id && enumeration(detail.f.resolve(c.type)) === row.type);
            if (matches.length !== 1) throw Error('Ambiguous Library child.');
            const value = projectChild(detail.f, row, detail.parent, matches[0], first.scope, first.groupMap.get(row.productEntitlementId), result.checkedAt);
            rows.set(ref, { row, value });
          } catch (error) { if (error.fatalScope) throw error; result.unresolvedItems++; fail('item-unresolved'); }
        }
        progress({ pagesRead: result.pagesRead, verifiedItems: rows.size, unresolvedItems: result.unresolvedItems });
        if (page === result.reportedPages) { if (!result.failures.length) result.coverage = 'accessible-pages-traversed'; break; }
      }
      const final = await envelope(fetcher);
      if (scopeKey(final.scope) !== scopeKey(first.scope)) throw Error('The Humble account changed. No observations were saved.');
      result.verifiedItems = rows.size;
      const saved = await store('entitlementCommit', token, { scope: final.scope, observations: [...rows.values()].map(v => v.value), scan: result });
      finished = true; return saved;
    } finally { if (!finished) await store('entitlementAbort', token).catch(() => {}); }
  }
  function installPanel({ fetcher = global.fetch.bind(global) } = {}) {
    if (!ENABLED || document.getElementById('hcl-library-entitlement-pilot')) return;
    const panel = document.createElement('section'); panel.id = 'hcl-library-entitlement-pilot';
    const heading = document.createElement('strong'); heading.textContent = 'Humble Library — entitlement pilot';
    const description = document.createElement('p'); description.textContent = 'Read a limited part of your signed-in Library. Historical purchases and corrections stay unchanged. This does not check your complete purchase history.';
    const label = document.createElement('label'), confirm = document.createElement('input'); confirm.type = 'checkbox';
    label.append(confirm, ' I checked that this signed-in Humble account belongs to the selected saved account.');
    const pages = document.createElement('select'); pages.setAttribute('aria-label','Maximum Library pages');
    for (const n of [1,5,10]) { const o = document.createElement('option'); o.value = String(n); o.textContent = `Up to ${n} ${n === 1 ? 'page' : 'pages'}`; pages.append(o); } pages.value = '5';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Check Library entitlements';
    const status = document.createElement('p'); status.setAttribute('role','status');
    let expectedContext;
    global.HumbleComicLibrary.storageRequest('entitlementContext').then(value => {
      expectedContext = value; description.textContent += ' Saved account: ' + (value.profileLabel || 'unnamed') + '.';
    }, () => { status.textContent = 'The saved account is unavailable. Open Extension options before checking.'; });
    button.addEventListener('click', async () => {
      if (!confirm.checked) { status.textContent = 'Confirm the signed-in account before checking. Your records are unchanged.'; return; }
      if (!expectedContext) { status.textContent = 'Wait for the saved account to load, then confirm it before checking.'; return; }
      button.disabled = true; pages.disabled = true; status.textContent = 'Checking Library entitlements…';
      try {
        const value = await collect({ fetcher, expectedContext, store: (operation,...args) => global.HumbleComicLibrary.storageRequest(operation,...args), confirmed: true, pageLimit: Number(pages.value),
          progress: p => { status.textContent = `Checked ${p.pagesRead} pages; ${p.verifiedItems} entitlement observations read.`; } });
        status.textContent = `Saved ${value.saved.toLocaleString()} entitlement observations. ${value.scan.unresolvedItems ? `${value.scan.unresolvedItems.toLocaleString()} items remain unresolved. ` : ''}${value.scan.coverage === 'incomplete' ? 'The check was interrupted; readable observations were kept.' : 'This was a limited Library check.'} Historical purchases were kept. This does not establish complete history or Steam activation.`;
      } catch { status.textContent = 'The Library check could not be saved. Existing records were kept. Check the signed-in and saved accounts, then try again.'; }
      finally { button.disabled = false; pages.disabled = false; }
    });
    panel.append(heading, description, label, pages, button, status); document.body.append(panel);
  }
  global.HumbleLibraryEntitlements = Object.freeze({ ENABLED, MAX_RECORDS, MAX_PAGES, collection, observation, identity, scopeKey, admission, scan, matchingItems, projectForGL, flight, collect, installPanel });
})(globalThis);
