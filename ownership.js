/* Identity and contents calculations shared by storefront explanations/plans. */
(function attachOwnership(global) {
  'use strict';
  const H = global.HumbleComicLibrary;
  const C = global.HumbleCollectionMappings;
  const permanent = record => ['owned', 'claimed'].includes(record?.ownership);
  const key = C.scopeKey;
  const intersect = (left, right) => left.some(value => right.includes(value));

  function editionParts(title, kind = 'book') {
    const normalized = H.normalizeTitle(title);
    const suffix = kind === 'game'
      ? /\s+(?:(?:base game|standard|deluxe|gold|platinum|ultimate|complete|definitive|collectors?|anniversary|remastered|enhanced|premium|super|game of the year|goty)(?:\s+edition)?|[\p{L}\p{N}]+ edition)$/iu
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
    const target = H.normalizeTitle(offered.lookupTitle ?? offered.title);
    const related = records.filter(record => !conflicts(offered, record).length
      && (H.normalizeTitle(record.title) === target || sharedIdentity(offered, record)));
    const compatible = related.filter(record => !conflicts(offered, record, true).length);
    // A literal local ownership assertion is usable; a lossy title key alone
    // is not. Multiple homonyms require independent edition/author evidence.
    const literal = value => H.text(value).toLowerCase();
    const exact = compatible.find(record => sharedIdentity(offered, record) || currentBundle(record)
      || compatible.length === 1 && related.length === 1 && literal(record.title) === literal(offered.lookupTitle ?? offered.title));
    return { exact, possible: exact ? [] : related, reason: related.length
      ? related.map(record => `${record.title}: ${conflicts(offered, record, true).join('; ') || 'Title identity needs review'}`).join('\n') : '' };
  }

  function offerContents(item, mappings) {
    const applicable = mappings.filter(mapping => C.mappingMatches(mapping, item));
    // Two conflicting reviewed maps must not silently choose a contents list.
    const lists = applicable.map(mapping => C.expandContents(mapping));
    const fingerprints = new Set(lists.map(entries => JSON.stringify(entries.map(C.contentKey).sort())));
    if (fingerprints.size > 1) return { entries: [], complete: false, uncertain: true, reason: 'Conflicting collection mappings' };
    if (lists.length) return { entries: lists[0], complete: applicable.some(mapping => mapping.contentsComplete === true), mappings: applicable, uncertain: false };
    return { entries: item.kind === 'book' || !item.kind ? C.titleContents(item.lookupTitle ?? item.title, H.bibliographicFields(item)) : [], complete: false, mappings: [], uncertain: false };
  }

  function localEvidence(records, mappings) {
    const entries = [];
    for (const item of records) {
      for (const mapping of mappings) {
        if (!C.mappingMatches(mapping, item)) continue;
        for (const unit of C.expandContents(mapping)) if (unit.completeness === 'full') entries.push({ ...unit,
          evidence: [{ provider: 'humble', title: item.title, ownership: 'owned', relationship: 'contains',
            reason: mapping.sourceLabel || 'Reviewed local mapping', evidence: { source: mapping.sourceLabel, checkedAt: mapping.verifiedAt || null }, item, mapping }] });
      }
      const units = C.titleContents(item.title, H.bibliographicFields(item));
      // A multi-unit title is a query hint, never an owned contents assertion.
      if (units.length === 1) entries.push({ ...units[0], evidence: [{ provider: 'humble', title: item.title, ownership: 'owned', relationship: 'same-edition', item,
        reason: 'Locally owned single issue/volume; scope must agree' }] });
    }
    return entries;
  }

  function coverageFor(target, local, external = null) {
    const units = [...new Map(target.entries.filter(entry => entry.completeness === 'full').map(entry => [C.contentKey(entry), entry])).values()];
    const covered = []; const possibleCovered = []; const missing = [];
    const candidates = [...local, ...(external?.coverage?.covered ?? []), ...(external?.coverage?.possibleCovered ?? []).map(entry => ({ ...entry, uncertain: true }))];
    for (const unit of units) {
      const confirmed = []; const possible = [];
      for (const candidate of candidates) {
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

  function request(item, mappings = []) {
    const mediaType = item.kind; const title = H.text(item.lookupTitle ?? item.title);
    const data = H.bibliographicFields(item); const fields = { mediaType, title, excludeProviders: ['humble'] };
    const identifiers = {};
    for (const name of ['isbn', 'asin', 'workId']) if (data[name]) identifiers[name] = data[name];
    if (Object.keys(identifiers).length) fields.identifiers = identifiers;
    for (const name of ['authors', 'language', 'edition', 'series', 'run', 'volume', 'issue']) if (data[name]) fields[name] = data[name];
    const target = offerContents(item, mappings);
    if (target.entries.length) {
      fields.contents = target.entries.map(entry => ({ series: entry.series, run: entry.run, unitType: entry.unitType,
        number: entry.number, language: entry.language, completeness: entry.completeness }));
      fields.contentsComplete = target.complete;
    }
    return fields;
  }

  global.HumbleOwnership = { permanent, editionParts, conflicts, sharedIdentity, exactCandidate, offerContents, localEvidence, coverageFor, request };
}(globalThis));
