/* Identity and contents calculations shared by storefront explanations/plans. */
(function attachOwnership(global) {
  'use strict';
  const H = global.HumbleComicLibrary;
  const C = global.HumbleCollectionMappings;
  const permanent = record => ['owned', 'claimed'].includes(record?.ownership);
  function purchased(item) {
    const records = item.provenance?.length ? item.provenance : [item];
    return records.some(record => record.entitlement !== 'third-party-key' || !['expired', 'unavailable'].includes(record.keyStatus));
  }
  const key = C.scopeKey;
  const intersect = (left, right) => left.some(value => right.includes(value));
  const localContentsIndexes = new WeakMap();
  const mappingIndexes = new WeakMap();
  const unitKey = entry => JSON.stringify([key(entry.series), entry.unitType, C.numberKey(entry.number)]);
  function indexContents(entries) {
    const index = new Map();
    for (const entry of entries) { const token = unitKey(entry); const group = index.get(token) ?? []; group.push(entry); index.set(token, group); }
    return index;
  }

  function editionParts(title, kind = 'book') {
    const normalized = H.normalizeTitle(title);
    const suffix = kind === 'game'
      ? /\s+(?:(?:base(?: game)?|standard|digital deluxe|deluxe|gold|platinum|ultimate|complete|definitive|collectors?|anniversary|remastered|enhanced|premium|super|game of the year|goty)(?:\s+edition)?|complete pack|ultimate collection|collection|trilogy|[\p{L}\p{N}]+ edition)$/iu
      : /\s+(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|expanded|annotated|new|deluxe|dlx)(?:\s+(?:revised|updated))?\s+(?:edition|ed)|deluxe|dlx)$/iu;
    const found = suffix.exec(normalized);
    return { base: found ? normalized.slice(0, found.index).trim() : normalized, edition: found ? found[0].trim() : '' };
  }

  function conflicts(offered, owned, exact = false) {
    const left = H.bibliographicFields(offered); const right = H.bibliographicFields(owned);
    const reasons = [];
    if (left.authors?.length && right.authors?.length && !intersect(left.authors.map(key), right.authors.map(key))) reasons.push('Different known authors');
    for (const field of ['seriesId', 'runId', 'series', 'run', 'volume', 'issue', 'unitType']) {
      if (left[field] && right[field] && key(left[field]) !== key(right[field])) reasons.push(`Different ${field}`);
    }
    const leftUnits = C.titleContents(offered.title, left); const rightUnits = C.titleContents(owned.title, right);
    if (leftUnits.length === 1 && rightUnits.length === 1) {
      for (const field of ['series', 'run', 'unitType']) if (leftUnits[0][field] && rightUnits[0][field] && key(leftUnits[0][field]) !== key(rightUnits[0][field])) reasons.push(`Different ${field}`);
      if (C.numberKey(leftUnits[0].number) !== C.numberKey(rightUnits[0].number)) reasons.push('Different issue/volume');
    }
    if (exact) {
      const limited = title => /\b(?:preview|sample|excerpt|read\s+now|demo|trial)\b/iu.test(title);
      if (limited(offered.title) !== limited(owned.title)) reasons.push('Preview/sample and full-product access differ');
      if (leftUnits.length && rightUnits.length && JSON.stringify(leftUnits.map(entry => `${entry.unitType}:${C.numberKey(entry.number)}`).sort()) !== JSON.stringify(rightUnits.map(entry => `${entry.unitType}:${C.numberKey(entry.number)}`).sort())) reasons.push('Different enumerated issues/volumes');
      if ((left.editionId || right.editionId) && left.editionId !== right.editionId) reasons.push('Edition ID not established on both items');
      for (const field of ['language', 'editionId', 'edition']) if (left[field] && right[field] && key(left[field]) !== key(right[field])) reasons.push(`Different ${field}`);
      if (left.isbn?.length && right.isbn?.length && !intersect(left.isbn, right.isbn)) reasons.push('Different validated ISBNs');
      if (left.asin && right.asin && left.asin !== right.asin) reasons.push('Different ASINs');
      const lp = editionParts(offered.title, offered.kind); const rp = editionParts(owned.title, offered.kind);
      if (lp.base === rp.base && lp.edition !== rp.edition) reasons.push('Different edition/package wording');
    }
    return [...new Set(reasons)];
  }

  function sharedIdentity(offered, owned) {
    const left = H.bibliographicFields(offered); const right = H.bibliographicFields(owned);
    return Boolean(left.isbn?.length && right.isbn?.length && intersect(left.isbn, right.isbn)
      || left.asin && left.asin === right.asin
      || left.editionId && left.editionId === right.editionId
      || left.authors?.length && right.authors?.length && intersect(left.authors.map(key), right.authors.map(key)));
  }

  function exactCandidate(offered, records, currentBundle = () => false) {
    const editionIdentifier = record => {
      const left = H.bibliographicFields(offered); const right = H.bibliographicFields(record);
      return Boolean(left.isbn?.length && right.isbn?.length && intersect(left.isbn, right.isbn)
        || left.asin && left.asin === right.asin || left.editionId && left.editionId === right.editionId);
    };
    const related = records.filter(record => !conflicts(offered, record).length
      && (H.titleKey(record.title) === H.titleKey(offered.lookupTitle ?? offered.title)
        || H.presentationTitle(record.title, offered.kind) === H.presentationTitle(offered.lookupTitle ?? offered.title, offered.kind) || editionIdentifier(record)));
    const compatible = related.filter(record => !conflicts(offered, record, true).length);
    // Unique presentation equality can establish local ownership without
    // enrichment. Lossy keys and ambiguous homonyms still need identity proof.
    const presentation = value => H.presentationTitle(value, offered.kind);
    const exact = compatible.find(record => purchased(record) && (editionIdentifier(record)
      || H.presentationTitle(record.title, offered.kind) === H.presentationTitle(offered.lookupTitle ?? offered.title, offered.kind) && (sharedIdentity(offered, record) || currentBundle(record))
      || compatible.length === 1 && related.length === 1 && presentation(record.title) && presentation(record.title) === presentation(offered.lookupTitle ?? offered.title)));
    return { exact, possible: exact ? [] : related, reason: related.length
      ? related.map(record => `${record.title}: ${conflicts(offered, record, true).join('; ') || 'Title identity needs review'}`).join('\n') : '' };
  }

  function offerContents(item, mappings) {
    let index = mappingIndexes.get(mappings);
    if (!index) {
      index = new Map();
      for (const mapping of mappings) {
        const token = H.normalizeTitle(mapping.collectionTitle); const rows = index.get(token) ?? [];
        rows.push(mapping); index.set(token, rows);
      }
      mappingIndexes.set(mappings, index);
    }
    const matched = (index.get(H.normalizeTitle(item.title)) ?? []).filter(mapping => C.mappingMatches(mapping, item));
    const specific = matched.filter(mapping => mapping.editionId || mapping.identifiers);
    const applicable = specific.length ? specific : matched;
    // Two conflicting reviewed maps must not silently choose a contents list.
    const lists = applicable.map(mapping => C.expandContents(mapping));
    const fingerprints = new Set(lists.map(entries => JSON.stringify(entries.map(entry => `${C.contentKey(entry)}:${entry.completeness}`).sort())));
    if (fingerprints.size > 1) return { entries: [], complete: false, uncertain: true, reason: 'Conflicting collection mappings' };
    if (lists.length) return { entries: lists[0], complete: applicable.some(mapping => mapping.contentsComplete === true), mappings: applicable, uncertain: false };
    return { entries: item.kind === 'book' || !item.kind ? C.titleContents(item.lookupTitle ?? item.title, H.bibliographicFields(item)) : [], complete: false, mappings: [], uncertain: false };
  }

  function localEvidence(records, mappings) {
    const entries = [];
    for (const item of records) {
      if (!purchased(item)) continue;
      const reviewed = offerContents(item, mappings);
      for (const mapping of reviewed.mappings ?? []) {
        for (const unit of C.expandContents(mapping)) if (unit.completeness === 'full') entries.push({ ...unit,
          evidence: [{ provider: 'humble', title: item.title, ownership: 'owned', relationship: 'contains',
            reason: mapping.sourceLabel || 'Reviewed local mapping', evidence: { source: mapping.sourceLabel, checkedAt: mapping.verifiedAt || null }, item, mapping }] });
      }
      const units = C.titleContents(item.title, H.bibliographicFields(item));
      // A multi-unit title is a query hint, never an owned contents assertion.
      if (units.length === 1 && !reviewed.uncertain && !(reviewed.mappings?.length && reviewed.entries.every(entry => entry.completeness === 'excerpt'))
        && !/\b(?:preview|sample|excerpt|read\s+now)\b/iu.test(item.title)) entries.push({ ...units[0], evidence: [{ provider: 'humble', title: item.title, ownership: 'owned', relationship: 'same-edition', item,
        reason: 'Locally owned single issue/volume; scope must agree' }] });
    }
    localContentsIndexes.set(entries, indexContents(entries));
    return entries;
  }

  function coverageFor(target, local, external = null) {
    const units = [...new Map(target.entries.filter(entry => entry.completeness === 'full').map(entry => [C.contentKey(entry), entry])).values()];
    const covered = []; const possibleCovered = []; const missing = [];
    const localIndex = localContentsIndexes.get(local) ?? indexContents(local);
    const externalIndex = indexContents([...(external?.coverage?.covered ?? []), ...(external?.coverage?.possibleCovered ?? []).map(entry => ({ ...entry, uncertain: true }))]);
    for (const unit of units) {
      const confirmed = []; const possible = [];
      for (const candidate of [...(localIndex.get(unitKey(unit)) ?? []), ...(externalIndex.get(unitKey(unit)) ?? [])]) {
        if (candidate.completeness === 'excerpt' || key(candidate.series) !== key(unit.series)
          || candidate.unitType !== unit.unitType || C.numberKey(candidate.number) !== C.numberKey(unit.number)) continue;
        if (unit.seriesId && candidate.seriesId && unit.seriesId !== candidate.seriesId || unit.runId && candidate.runId && unit.runId !== candidate.runId) continue;
        if (unit.run && candidate.run && key(unit.run) !== key(candidate.run) || unit.language && candidate.language && key(unit.language) !== key(candidate.language)) continue;
        const evidence = (candidate.evidence ?? []).filter(record => permanent(record) && (record.provider !== 'humble' || record.item));
        if (!evidence.length) continue;
        if (!candidate.uncertain && unit.run && candidate.run && unit.language && candidate.language && C.contentKey(unit) === C.contentKey(candidate)) confirmed.push(...evidence);
        else possible.push(...evidence);
      }
      if (confirmed.length) covered.push({ ...unit, evidence: confirmed });
      else {
        missing.push(unit);
        if (possible.length) possibleCovered.push({ ...unit, evidence: possible });
      }
    }
    const scopeUncertain = target.uncertain || units.some(entry => !entry.run || !entry.language) || possibleCovered.length > 0;
    return { total: units.length, owned: covered.length, complete: units.length > 0 && covered.length === units.length && !scopeUncertain,
      contentsComplete: target.complete, scopeUncertain, covered, possibleCovered, missing, target };
  }

  function request(item, mappings = [], targetOverride = null) {
    const mediaType = item.kind; const title = H.text(item.lookupTitle ?? item.title);
    const data = H.bibliographicFields(item); const fields = { mediaType, title, excludeProviders: ['humble'] };
    const identifiers = {};
    for (const name of ['isbn', 'asin', 'workId']) if (data[name]) identifiers[name] = data[name];
    if (Object.keys(identifiers).length) fields.identifiers = identifiers;
    for (const name of ['authors', 'language', 'edition', 'series', 'run', 'volume', 'issue']) if (data[name]) fields[name] = data[name];
    const target = targetOverride ?? offerContents(item, mappings);
    if (target.entries.length) {
      fields.contents = target.entries.map(entry => ({ series: entry.series, run: entry.run, unitType: entry.unitType,
        number: entry.number, language: entry.language, completeness: entry.completeness }));
      fields.contentsComplete = target.complete;
    }
    return fields;
  }

  function unitLabel(entry) {
    return `${entry.series}${entry.run ? ` (${entry.run})` : ''} ${entry.unitType} ${entry.number}${entry.language ? ` [${entry.language}]` : ''}`;
  }

  function explanationLines(match) {
    const offered = match.offered ?? {};
    const lines = [`Offered: ${offered.title || 'Unknown title'}`, `Status: ${match.state}`, `Media: ${offered.kind || 'book'}`];
    const describe = (label, value) => {
      const data = H.bibliographicFields(value);
      const fields = Object.entries(data).map(([name, entry]) => `${name}: ${Array.isArray(entry) ? entry.join(', ') : entry}`);
      lines.push(`${label}: ${fields.join(' · ') || 'No catalog identifiers, authors, edition, or language supplied.'}`);
    };
    describe('Offered evidence', offered);
    if (match.possibleReason) lines.push(match.possibleReason);
    if (match.ownedReason) lines.push(match.ownedReason);
    if (match.localMatch?.possibleReason && match.localMatch.possibleReason !== match.possibleReason) lines.push(`Local candidate: ${match.localMatch.possibleReason}`);
    if (match.mappingConflicts) lines.push(`Review needed: ${match.mappingConflicts}`);
    if (match.lookupIncomplete) lines.push('Central lookup incomplete. An unavailable or omitted result is not proof of absence.');
    if (match.contentsLookupIncomplete) lines.push('Central contents coverage unavailable; additional units cannot be confirmed.');
    const local = match.localMatch ?? match;
    const records = [local.item, ...(local.historicalItems ?? []), ...(local.range?.items ?? []), ...(match.externalMatches ?? []), ...(match.externalPossibleMatches ?? []),
      ...(match.externalResult?.partialMatches ?? []), ...(match.coverage?.covered ?? []).flatMap(entry => entry.evidence),
      ...(match.coverage?.possibleCovered ?? []).flatMap(entry => entry.evidence)].flat(Infinity).filter(Boolean);
    const seen = new Set();
    for (const record of records) {
      const item = record.item ?? record;
      const identity = `${record.provider || 'humble'}:${record.itemRef || H.catalogItemKey(item)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (item.historical) lines.push("Historical purchase: previously recorded in this profile; not observed in the current snapshot. Current access needs review.");
      lines.push(`Library item: ${item.title || 'Unnamed record'} · ${record.provider || 'humble'} · ${record.ownership || (purchased(item) ? 'locally recorded as owned' : 'purchase recorded; key needs review')}`);
      const data = record.evidence ? { ...record.evidence, title: record.title } : item;
      describe('Library evidence', data);
      const differences = conflicts(offered, data, true);
      if (differences.length) lines.push(`Differences: ${differences.join('; ')}`);
      if (record.reason || record.relationship) lines.push(`Basis: ${record.reason || record.relationship}${record.relationship ? ` (${record.relationship})` : ''}`);
      if (record.evidence?.source || record.evidence?.checkedAt || record.verifiedAt) lines.push(`Source: ${record.evidence?.source || 'GL review'} · checked ${record.evidence?.checkedAt || 'unknown'} · verified ${record.verifiedAt || 'unknown'}`);
      for (const provenance of item.provenance ?? [item]) if (provenance.sourceBundle) lines.push(`Humble bundle: ${provenance.sourceBundle}${provenance.purchasedAt ? ` · purchased ${provenance.purchasedAt}` : ''}`);
      for (const origin of item.provenance?.length ? item.provenance : [item]) {
        if (origin.entitlement === 'third-party-key' || item.kind === 'game' && item.source === 'humble') {
          lines.push(`Humble purchase evidence; key status: ${origin.keyStatus || 'unknown'}${origin.keyType ? ` (${origin.keyType})` : ''}${origin.expiresAt ? ` · reported expiry ${origin.expiresAt}` : ''}${origin.keyCheckedAt ? ` · checked ${origin.keyCheckedAt}` : ''}. Destination activation: unknown.`);
          lines.push('Purchase and key revelation do not prove activation in Steam or another destination library. An expired/unavailable key needs review and does not revoke a separately verified destination license.');
        }
      }
      if (record.evidence?.purchaseEvidence) lines.push(`Reseller purchase: ${record.evidence.purchaseEvidence}; key status: ${record.evidence.keyStatus || 'unknown'}; destination activation: ${record.evidence.activationStatus || 'unknown'}.`);
      if (record.mapping) lines.push(`Contents source: ${record.mapping.sourceLabel || 'Reviewed mapping'} · ${record.mapping.sourceUrl || 'No source URL'} · verified ${record.mapping.verifiedAt || 'date not supplied'}`);
    }
    const coverage = match.coverage;
    if (coverage?.total) {
      lines.push(`Contents: ${coverage.owned}/${coverage.total} full units confirmed covered.`);
      lines.push(coverage.contentsComplete ? 'The reviewed contents list describes the whole offered product.' : 'The target list does not establish the entire offered edition; full unit coverage alone is not edition ownership.');
      if (coverage.scopeUncertain) lines.push('Run/language or overlapping contents remain uncertain; uncertain units are not confirmed owned or confirmed new.');
      for (const [label, entries] of [['Covered', coverage.covered], ['Possible coverage', coverage.possibleCovered], ['Not confirmed covered', coverage.missing]]) {
        if (entries?.length) lines.push(`${label}: ${entries.slice(0, 100).map(unitLabel).join('; ')}${entries.length > 100 ? `; and ${entries.length - 100} more` : ''}`);
      }
    }
    if (!seen.size) lines.push('No matching ownership evidence was found in the checked libraries. New means no confirmed match; it is not a purchase guarantee.');
    return lines;
  }

  function wishlistMatches(wanted, item) {
    if ((wanted.kind ?? 'book') !== item.kind || H.normalizeTitle(wanted.title) !== H.normalizeTitle(item.title) || conflicts(wanted, item, true).length) return false;
    const left = H.bibliographicFields(wanted); const right = H.bibliographicFields(item);
    if (left.isbn?.length && !left.isbn.some(isbn => right.isbn?.includes(isbn))) return false;
    for (const field of ['asin', 'editionId', 'language', 'run']) if (left[field] && key(left[field]) !== key(right[field])) return false;
    if (left.authors?.length && !left.authors.some(author => right.authors?.map(key).includes(key(author)))) return false;
    return true;
  }

  function newUnits(match) {
    if (['owned', 'elsewhere', 'unchecked'].includes(match.state) || match.lookupIncomplete || match.contentsLookupIncomplete) return [];
    const uncertain = new Set((match.coverage?.possibleCovered ?? []).map(C.contentKey));
    return (match.coverage?.missing ?? []).filter(entry => entry.run && entry.language && !uncertain.has(C.contentKey(entry)));
  }

  function planBundle(resolved, wishlist = [], goal = 'items', includeUncertain = false) {
    const wants = H.normalizeWishlist(wishlist);
    const rows = resolved.map(({ item, match }) => ({ item, match, id: H.catalogItemKey(item), units: newUnits(match) }));
    const eligible = rows.filter(row => !['owned', 'elsewhere'].includes(row.match.state)
      && (row.match.state === 'new' || row.match.state === 'partial' && row.units.length > 0 || includeUncertain && ['possible', 'partial'].includes(row.match.state)));
    const goals = new Map();
    if (goal === 'contents') {
      for (const row of eligible) for (const unit of row.units) goals.set(`unit:${C.contentKey(unit)}`, new Set([`unit:${C.contentKey(unit)}`]));
    } else if (goal === 'wishlist') {
      for (const wanted of wants) {
        const candidates = eligible.filter(row => wishlistMatches(wanted, row.item));
        if (candidates.length) goals.set(`wish:${H.catalogItemKey(wanted)}`, new Set(candidates.map(row => `item:${row.id}`)));
      }
    } else {
      for (const row of eligible) if (row.match.state === 'new' || includeUncertain && ['possible', 'partial'].includes(row.match.state)) goals.set(`item:${row.id}`, new Set([`item:${row.id}`]));
    }
    const prices = [...new Set(rows.map(row => row.item.tier?.price).filter(price => Number.isFinite(price) && price >= 0))].sort((a, b) => a - b);
    let previousUnits = 0; let previousPrice = 0;
    const tiers = prices.map(price => {
      const available = rows.filter(row => Number.isFinite(row.item.tier?.price) && row.item.tier.price <= price);
      const usable = eligible.filter(row => available.includes(row));
      const tokens = new Set(usable.flatMap(row => [`item:${row.id}`, ...row.units.map(unit => `unit:${C.contentKey(unit)}`)]));
      const achieved = [...goals.values()].filter(alternatives => [...alternatives].some(token => tokens.has(token))).length;
      const unitKeys = new Set(usable.flatMap(row => row.units.map(C.contentKey)));
      const wishlistAtTier = wants.filter(wanted => usable.some(row => wishlistMatches(wanted, row.item)));
      const confirmedNewItems = new Set(available.filter(row => row.match.state === 'new').map(row => row.id)).size;
      const uncertainItems = new Set(usable.filter(row => row.match.state === 'possible' || row.match.state === 'partial' && !row.units.length).map(row => row.id)).size;
      const addedUnits = unitKeys.size - previousUnits;
      const marginalCost = price - previousPrice;
      previousUnits = unitKeys.size; previousPrice = price;
      return { price, confirmedNewItems, newUnits: unitKeys.size, addedUnits, wishlistCount: wishlistAtTier.length,
        wishlistValue: wishlistAtTier.reduce((sum, wanted) => sum + wanted.weight, 0), uncertainItems,
        costPerNewUnit: unitKeys.size ? price / unitKeys.size : null, marginalCostPerUnit: addedUnits ? marginalCost / addedUnits : null,
        achieved, satisfiesGoal: goals.size > 0 && achieved === goals.size };
    });
    return { goal, goalCount: goals.size, tiers, lowest: tiers.find(tier => tier.satisfiesGoal) ?? null,
      excludedUncertain: rows.filter(row => row.match.state === 'possible' || row.match.state === 'partial' && !row.units.length).length };
  }

  function seriesKey(entry) {
    return JSON.stringify([key(entry.series), key(entry.run), entry.unitType, key(entry.language), entry.seriesId || '', entry.runId || '']);
  }

  function readingTargets(resolved) {
    const groups = new Map();
    for (const { item, target } of resolved) {
      if (item.kind !== 'book') continue;
      for (const entry of target?.entries ?? []) {
        if (entry.completeness !== 'full') continue;
        const scope = seriesKey(entry);
        const group = groups.get(scope) ?? { ...entry, entries: new Map() };
        group.entries.set(C.contentKey(entry), entry); groups.set(scope, group);
      }
    }
    return [...groups.values()].map(group => {
      const entries = new Map(group.entries);
      const numeric = [...entries.values()].map(entry => Number(C.numberKey(entry.number))).filter(Number.isFinite);
      const first = Math.ceil(Math.min(...numeric)); const last = Math.floor(Math.max(...numeric));
      const bounded = ['issue', 'volume', 'annual'].includes(group.unitType) && numeric.length > 0 && last - first <= 1999;
      if (bounded) for (let number = first; number <= last && entries.size < 2000; number++) {
        const entry = { series: group.series, run: group.run, unitType: group.unitType, language: group.language, number: String(number), completeness: 'full',
          ...(group.seriesId ? { seriesId: group.seriesId } : {}), ...(group.runId ? { runId: group.runId } : {}) };
        if (!entries.has(C.contentKey(entry))) entries.set(C.contentKey(entry), entry);
      }
      return { item: { title: `Series coverage: ${group.series}${group.run ? ` (${group.run})` : ''} ${group.unitType} [${group.language || 'unknown language'}]`,
          kind: 'book', series: group.series, run: group.run, language: group.language },
        match: { state: 'new' }, target: { entries: [...entries.values()], complete: false, uncertain: false },
        enumerationLimited: numeric.length > 0 && !bounded };
    });
  }

  function seriesCoverage(queries, local, resultsByKey = new Map(), centralEnabled = false) {
    return queries.map(query => {
      const result = resultsByKey.get(query.item.galacticKey);
      const lookupIncomplete = centralEnabled && !result?.coverage;
      const coverage = coverageFor(query.target, local, result);
      const covered = new Map(coverage.covered.map(entry => [C.contentKey(entry), entry]));
      const possible = new Map(coverage.possibleCovered.map(entry => [C.contentKey(entry), entry]));
      const first = query.target.entries[0];
      const entries = query.target.entries.map(entry => ({ ...entry,
        state: covered.has(C.contentKey(entry)) ? 'covered' : lookupIncomplete || possible.has(C.contentKey(entry)) || !entry.run || !entry.language ? 'uncertain' : 'gap',
        evidence: covered.get(C.contentKey(entry))?.evidence ?? possible.get(C.contentKey(entry))?.evidence ?? []
      })).sort((a, b) => {
        const left = Number(C.numberKey(a.number)); const right = Number(C.numberKey(b.number));
        return Number.isFinite(left) && Number.isFinite(right) ? left - right : a.number.localeCompare(b.number, undefined, { numeric: true });
      });
      return { series: first.series, run: first.run, language: first.language, unitType: first.unitType,
        entries, covered: coverage.owned, gaps: entries.filter(entry => entry.state === 'gap'), uncertain: entries.filter(entry => entry.state === 'uncertain'),
        enumerationLimited: query.enumerationLimited, lookupIncomplete };
    }).sort((a, b) => a.series.localeCompare(b.series, undefined, { numeric: true }) || a.run.localeCompare(b.run));
  }

  global.HumbleOwnership = { permanent, purchased, editionParts, conflicts, sharedIdentity, exactCandidate, offerContents, localEvidence, coverageFor, request, unitLabel, explanationLines, wishlistMatches, newUnits, planBundle, seriesKey, readingTargets, seriesCoverage };
}(globalThis));
