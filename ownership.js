/* Identity and contents calculations shared by storefront explanations/plans. */
(function attachOwnership(global) {
  'use strict';
  const H = global.HumbleComicLibrary;
  const C = global.HumbleCollectionMappings;
  const policy = global.LibraryMatchingPolicy;
  const permanent = record => ['owned', 'claimed'].includes(record?.ownership);
  function purchased(item) {
    const records = item.provenance?.length ? item.provenance : [item];
    return records.some(record => record.entitlement !== 'third-party-key' || !['expired', 'unavailable'].includes(record.keyStatus));
  }
  const key = C.scopeKey;
  const intersect = (left, right) => left.some(value => right.includes(value));
  const localContentsIndexes = new WeakMap();
  const mappingIndexes = new WeakMap();
  const unitKey = entry => JSON.stringify([key(entry.series), entry.unitType, C.numberKey(entry.number, entry.unitType)]);
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
    const authors = policy.authorRelation(left.authors, right.authors);
    if (authors === 'different') reasons.push('Different known authors');
    const sharedEdition = left.isbn?.length && right.isbn?.length && intersect(left.isbn, right.isbn)
      || left.asin && left.asin === right.asin || left.editionId && left.editionId === right.editionId;
    if (exact && authors === 'variant' && !sharedEdition) reasons.push('Author name variation needs review');
    for (const field of ['seriesId', 'runId', 'run', 'volume', 'issue', 'unitType', ...(exact ? ['series'] : [])]) {
      const normalize = ['volume', 'issue'].includes(field) ? policy.unitKey : key;
      if (left[field] && right[field] && normalize(left[field]) !== normalize(right[field])) reasons.push(`Different ${field}`);
    }
    const leftUnits = C.titleContents(offered.title, left); const rightUnits = C.titleContents(owned.title, right);
    if (leftUnits.length === 1 && rightUnits.length === 1) {
      for (const field of ['series', 'run', 'unitType']) if (leftUnits[0][field] && rightUnits[0][field] && key(leftUnits[0][field]) !== key(rightUnits[0][field])) reasons.push(`Different ${field}`);
      if (C.numberKey(leftUnits[0].number) !== C.numberKey(rightUnits[0].number)) reasons.push('Different issue/volume');
    }
    if (exact) {
      if (policy.revisionWordingConflict(offered.title, owned.title, offered.kind)) reasons.push('Different revision wording');
      const limited = title => /\b(?:preview|sample|excerpt|read\s+now|demo|trial)\b/iu.test(title);
      if (limited(offered.title) !== limited(owned.title)) reasons.push('Preview/sample and full-product access differ');
      if (leftUnits.length && rightUnits.length && JSON.stringify(leftUnits.map(entry => `${entry.unitType}:${C.numberKey(entry.number)}`).sort()) !== JSON.stringify(rightUnits.map(entry => `${entry.unitType}:${C.numberKey(entry.number)}`).sort())) reasons.push('Different enumerated issues/volumes');
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
      || policy.authorRelation(left.authors, right.authors) === 'same');
  }

  function exactCandidate(offered, records) {
    const editionIdentifier = record => {
      const left = H.bibliographicFields(offered); const right = H.bibliographicFields(record);
      return Boolean(left.isbn?.length && right.isbn?.length && intersect(left.isbn, right.isbn)
        || left.asin && left.asin === right.asin || left.editionId && left.editionId === right.editionId);
    };
    const related = records.filter(record => !conflicts(offered, record).length
      && (H.titleKey(record.title) === H.titleKey(offered.lookupTitle ?? offered.title)
        || policy.fullTitleMatches(offered.lookupTitle ?? offered.title, record.title, offered.kind) || editionIdentifier(record)));
    const compatible = related.filter(record => !conflicts(offered, record, true).length);
    // Repeated observations do not create ambiguity. Known different works
    // still require enough evidence to select the offered identity.
    const identified = compatible.filter(editionIdentifier);
    const full = compatible.filter(record => policy.fullTitleMatches(offered.lookupTitle ?? offered.title, record.title, offered.kind));
    const pool = identified.length ? identified : full;
    const ambiguous = policy.ambiguousWorks(pool, H.bibliographicFields);
    // Identity is independent of whether a recorded key is still available.
    const exact = ambiguous ? undefined : pool[0];
    const ownedExact = ambiguous ? undefined : pool.find(purchased);
    return { exact, ownedExact, possible: ownedExact ? [] : related, reason: related.length
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
          || candidate.unitType !== unit.unitType || C.numberKey(candidate.number, candidate.unitType) !== C.numberKey(unit.number, unit.unitType)) continue;
        if (unit.seriesId && candidate.seriesId && unit.seriesId !== candidate.seriesId || unit.runId && candidate.runId && unit.runId !== candidate.runId) continue;
        if (unit.run && candidate.run && key(unit.run) !== key(candidate.run) || unit.language && candidate.language && key(unit.language) !== key(candidate.language)) continue;
        const evidence = (candidate.evidence ?? []).filter(record => permanent(record) && (record.provider !== 'humble' || record.item));
        if (!evidence.length) continue;
        // Legacy mappings/central rows have no trusted parent identity for
        // named components; equality cannot establish full ownership.
        if (unit.unitType !== 'component' && !candidate.uncertain && unit.run && candidate.run && unit.language && candidate.language && C.contentKey(unit) === C.contentKey(candidate)) confirmed.push(...evidence);
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
    const lines = [`Offered: ${offered.title || 'Unknown title'}`, `Status: ${match.ownershipReview?'Check ownership':({owned:'Owned',elsewhere:'Owned elsewhere',possible:'Possible',partial:'Partial',unchecked:'Check incomplete',new:'New'}[match.state]??match.state)}`, `Media: ${offered.kind || 'book'}`];
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
    if (match.lookupIncomplete) lines.push('Ownership check incomplete: Galactic Library could not complete this check. Local evidence is retained; this item may already be owned. A failed lookup is not proof of absence.');
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


  function wishlistRelation(wanted, item) {
    const kind=(item.kind??item.mediaType??'book'), wantedKind=(wanted.kind??wanted.mediaType??'book');
    if(kind!==wantedKind)return 'none';
    const a=H.bibliographicFields(wanted), b=H.bibliographicFields(item), policy=global.LibraryMatchingPolicy;
    const hard=conflicts(item,wanted,false);
    if(hard.some(reason=>/issue|volume|unitType|seriesId|runId|Different run/iu.test(reason)))return 'none';
    const issues=value=>{const match=/(?:#|\bvol(?:ume)?s?\.?\s*)(\d+(?:\.\d+|\/\d+)?)/iu.exec(value.title||'');return match?policy.unitKey(match[1]):'';};
    if(issues(item)&&issues(wanted)&&issues(item)!==issues(wanted))return 'none';
    const shared=Boolean(a.isbn?.some(id=>b.isbn?.includes(id))||a.asin&&a.asin===b.asin||a.editionId&&a.editionId===b.editionId);
    const sameTitle=policy.fullTitleMatches(item.title,wanted.title,kind);
    const differences=conflicts(item,wanted,true).filter(reason=>reason!=='Author name variation needs review');
    const packageLabel=value=>kind==='game'?(String(value).match(/\b(base(?: game)?|standard|deluxe|gold|platinum|ultimate|complete|definitive|premium|goty|game of the year)(?: edition)?\s*$/iu)?.[0]||'').toLowerCase():'';
    const packageDifference=packageLabel(item.title)!==packageLabel(wanted.title);
    const strong=shared||sameTitle||Boolean((item.externalIds?.steamAppId||item.steamAppId)&&(item.externalIds?.steamAppId||item.steamAppId)===(wanted.externalIds?.steamAppId||wanted.steamAppId));
    if(strong&&!differences.length&&!packageDifference)return 'match';
    if(strong||H.possibleTitleRelation(wanted.title,item.title,kind))return 'related';
    return 'none';
  }
  function wishlistIntentKey(item) {
    const data=H.bibliographicFields(item);
    return JSON.stringify([(item.kind??item.mediaType??'book'),global.LibraryMatchingPolicy.presentationTitle(item.title,(item.kind??item.mediaType??'book')),Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,Array.isArray(value)?[...value].sort():value]))]);
  }
  function planningWishes(wishlist) {
    const unique=new Map();
    for(const wish of H.normalizeWishlist(wishlist)){const id=wishlistIntentKey(wish),previous=unique.get(id);if(!previous||wish.weight>previous.weight)unique.set(id,wish);}
    return [...unique.values()];
  }

  const wishlistMatches=(wanted,item)=>wishlistRelation(wanted,item)==='match';

  function newUnits(match) {
    if (['owned', 'elsewhere', 'unchecked'].includes(match.state) || match.lookupIncomplete || match.contentsLookupIncomplete) return [];
    const uncertain = new Set((match.coverage?.possibleCovered ?? []).map(C.contentKey));
    return (match.coverage?.missing ?? []).filter(entry => entry.run && entry.language && !uncertain.has(C.contentKey(entry)));
  }

  function planBundle(resolved, wishlist = [], goal = 'items', includeUncertain = false) {
    const wants = planningWishes(wishlist);
    const verifiedUnits=new Set(bundleContents(resolved).additional.map(C.contentKey));
    const rows = resolved.map(({ item, match }) => ({ item, match, id: H.catalogItemKey(item), units: newUnits(match).filter(unit=>verifiedUnits.has(C.contentKey(unit))) }));
    const eligible = rows.filter(row => !['owned', 'elsewhere'].includes(row.match.state)
      && !row.match.lookupIncomplete && (row.match.state === 'new' || goal === 'contents' && row.match.state === 'partial' && row.units.length > 0 || includeUncertain && row.match.state === 'possible'));
    const goals = new Map();
    if (goal === 'contents') {
      for (const row of eligible) for (const unit of row.units) goals.set(`unit:${C.contentKey(unit)}`, new Set([`unit:${C.contentKey(unit)}`]));
    } else if (goal === 'wishlist') {
      for (const wanted of wants) {
        const candidates = eligible.filter(row => wishlistMatches(wanted, row.item));
        if (candidates.length) goals.set(`wish:${H.catalogItemKey(wanted)}`, new Set(candidates.map(row => `item:${row.id}`)));
      }
    } else {
      for (const row of eligible) if (row.match.state === 'new' || includeUncertain && row.match.state === 'possible') goals.set(`item:${row.id}`, new Set([`item:${row.id}`]));
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


  // Presentation analysis uses resolved explicit content evidence; it never
  // feeds aggregate results back into the ownership matcher.
  function bundleContents(resolved) {
    resolved=resolved.map(row=>({...row,target:row.target||row.match.coverage?.target||{entries:[...(row.match.coverage?.covered||[]),...(row.match.coverage?.missing||[])],uncertain:false}}));
    const covered=new Map(),uncertain=new Map(),additional=new Map(),perProduct=new Map();
    let noContentsProducts=0,incompleteProducts=0;
    for(const {match,target} of resolved){
      for(const entry of match.coverage?.covered||[])covered.set(C.contentKey(entry),entry);
      if(['owned','elsewhere'].includes(match.state)&&target?.mappings?.length&&!target.uncertain)
        for(const entry of target.entries)if(entry.completeness==='full'&&entry.run&&entry.language)covered.set(C.contentKey(entry),entry);
      for(const entry of match.coverage?.possibleCovered||[])uncertain.set(C.contentKey(entry),entry);
    }
    for(const {item,match,target={entries:[]}} of resolved){
      if(!target.entries.length){noContentsProducts++;continue;}
      const incomplete=match.lookupIncomplete||match.contentsLookupIncomplete||match.state==='unchecked'||target.uncertain;
      if(incomplete)incompleteProducts++;
      const units=perProduct.get(H.catalogItemKey(item))||new Set();
      for(const entry of target.entries){
        const id=C.contentKey(entry);if(entry.completeness!=='full'||covered.has(id))continue;
        if(incomplete||!entry.run||!entry.language||uncertain.has(id))uncertain.set(id,entry);
        else if(!['owned','elsewhere'].includes(match.state)){additional.set(id,entry);units.add(id);}
        else uncertain.set(id,entry);
      }
      perProduct.set(H.catalogItemKey(item),units);
    }
    for(const id of covered.keys()){uncertain.delete(id);additional.delete(id);}
    for(const id of uncertain.keys())additional.delete(id);
    const prices=[...new Set(resolved.map(row=>row.item.tier?.price).filter(price=>Number.isFinite(price)&&price>=0))].sort((a,b)=>a-b);
    const tiers=prices.map(price=>{const totals=new Set();for(const row of resolved.filter(row=>Number.isFinite(row.item.tier?.price)&&row.item.tier.price<=price))for(const id of perProduct.get(H.catalogItemKey(row.item))||[])if(additional.has(id))totals.add(id);return {price,additional:totals.size};});
    return {additional:[...additional.values()],covered:[...covered.values()],uncertain:[...uncertain.values()],noContentsProducts,incompleteProducts,tiers};
  }
  function centralReminders(matches, now=Date.now()) {
    const reminders=[],seen=new Set();
    const add=(record,type,text)=>{const id=`${record.provider}:${record.itemRef||record.title}:${type}`;if(seen.has(id))return;seen.add(id);reminders.push({type,title:record.title||'Unnamed central item',provider:record.provider||'Galactic Library',text});};
    for(const match of matches){
      const result=match.externalResult;if(!result)continue;
      const records=[...(result.matches||[]),...(result.possibleMatches||[]),...(result.partialMatches||[]),...(match.coverage?.covered||[]).flatMap(entry=>entry.evidence||[]),...(match.coverage?.possibleCovered||[]).flatMap(entry=>entry.evidence||[])];
      for(const record of records){
        if(record.provider==='humble')continue;
        if(!permanent(record)&&!['owned','elsewhere'].includes(match.state))add(record,'ownership',`${record.ownership||'unknown'} ownership${['rental','borrowed','subscription'].includes(record.ownership)?'; temporary access does not establish permanent ownership. Expiry dates are unavailable here.':'; confirm purchase or permanent claim in Galactic Library.'}`);
        const observed=Date.parse(record.evidence?.checkedAt||''),reviewed=Date.parse(record.verifiedAt||'');
        if(!Number.isFinite(observed))add(record,'freshness','Observation date unavailable; check provider sync and ownership evidence in Galactic Library.');
        else if(now-observed>30*86400000)add(record,'freshness',`Last observed ${record.evidence.checkedAt}; refresh provider sync. Age does not revoke a recorded permanent purchase.`);
        if(Number.isFinite(reviewed)&&now-reviewed>30*86400000)add(record,'contents',`Contents reviewed ${record.verifiedAt}; review edition/contents if the offer differs.`);
      }
      if(match.coverage?.possibleCovered?.length)reminders.push({type:'scope',title:match.offered?.title,provider:'Galactic Library',text:'Possible coverage needs run/language confirmation; review its contents scope.'});
      if(match.contentsLookupIncomplete)reminders.push({type:'coverage',title:match.offered?.title,provider:'Galactic Library',text:'Central contents coverage was not supplied. Refresh or update the paired library before treating units as absent.'});
    }
    return reminders;
  }

  function seriesKey(entry) {
    return JSON.stringify([key(entry.series), key(entry.run), entry.unitType, key(entry.language), entry.seriesId || '', entry.runId || '']);
  }

  function readingTargets(resolved) {
    const groups=new Map();let limited=false,budget=20000;
    for(const {item,target}of resolved){
      if(item.kind!=='book')continue;
      for(const entry of target?.entries||[]){
        if(entry.completeness!=='full')continue;
        const scope=seriesKey(entry);if(!groups.has(scope)&&groups.size>=100){limited=true;continue;}
        const group=groups.get(scope)||{...entry,entries:new Map(),unknownScope:Boolean(!entry.run||!entry.language||target.uncertain)};
        group.unknownScope ||= Boolean(target.uncertain);
        if(group.entries.size>=2000&&!group.entries.has(C.contentKey(entry))){limited=true;continue;}
        group.entries.set(C.contentKey(entry),entry);groups.set(scope,group);
      }
    }
    const queries=[];
    for(const group of groups.values()){
      if(budget<=0){limited=true;break;}
      const offeredKeys=new Set(group.entries.keys()),entries=new Map(group.entries);
      const numeric=[...entries.values()].map(entry=>Number(C.numberKey(entry.number))).filter(Number.isFinite);
      const first=Math.ceil(numeric.reduce((a,b)=>Math.min(a,b),Infinity)),last=Math.floor(numeric.reduce((a,b)=>Math.max(a,b),-Infinity));
      const sequence=['issue','volume'].includes(group.unitType)&&!group.unknownScope&&numeric.length===entries.size;
      const bounded=sequence&&last-first<2000&&last-first<budget;
      if(bounded)for(let number=first;number<=last&&entries.size<Math.min(2000,budget);number++){
        const entry={...group,number:String(number),completeness:'full'};delete entry.entries;delete entry.unknownScope;
        if(!entries.has(C.contentKey(entry)))entries.set(C.contentKey(entry),entry);
      }
      const targetEntries=[...entries.values()].slice(0,Math.min(2000,budget));budget-=targetEntries.length;
      const enumerationLimited=Boolean(sequence&&!bounded||targetEntries.length<entries.size);limited ||= enumerationLimited;
      queries.push({item:{title:`Series coverage: ${group.series}${group.run?` (${group.run})`:''} ${group.unitType} [${group.language||'unknown language'}]`,kind:'book',series:group.series,run:group.run,language:group.language},match:{state:'new'},target:{entries:targetEntries,complete:false,uncertain:group.unknownScope},offeredKeys,unknownScope:group.unknownScope,enumerationLimited});
    }
    queries.limited=limited;return queries;
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
        state: covered.has(C.contentKey(entry)) ? 'covered' : query.unknownScope || lookupIncomplete || possible.has(C.contentKey(entry)) || !entry.run || !entry.language ? 'uncertain' : 'gap',
        evidence: covered.get(C.contentKey(entry))?.evidence ?? possible.get(C.contentKey(entry))?.evidence ?? []
      })).sort((a, b) => {
        const left = Number(C.numberKey(a.number)); const right = Number(C.numberKey(b.number));
        return Number.isFinite(left) && Number.isFinite(right) ? left - right : a.number.localeCompare(b.number, undefined, { numeric: true });
      });
      return { series: first.series, run: first.run, language: first.language, unitType: first.unitType,
        entries, offeredKeys: query.offeredKeys, externalResult: result, coverage, offered: query.item, covered: coverage.owned, gaps: entries.filter(entry => entry.state === 'gap'), uncertain: entries.filter(entry => entry.state === 'uncertain'),
        enumerationLimited: query.enumerationLimited, lookupIncomplete };
    }).sort((a, b) => a.series.localeCompare(b.series, undefined, { numeric: true }) || String(a.run||'').localeCompare(String(b.run||'')));
  }

  global.HumbleOwnership = { permanent, purchased, editionParts, conflicts, sharedIdentity, exactCandidate, offerContents, localEvidence, coverageFor, request, unitLabel, explanationLines, wishlistMatches, wishlistRelation, wishlistIntentKey, planningWishes, newUnits, planBundle, bundleContents, centralReminders, seriesKey, readingTargets, seriesCoverage };
}(globalThis));

// BEGIN SHARED BUNDLE MATCH CONTEXT
// Canonical source: GalacticLibrary/shared/bundle-match-context.js.
// Vendored unchanged in HB/FAN; synchronize with sync-companion-bundle-context.mjs.
(function installBundleMatchContext(global) {
  'use strict';
  // A priority projection only. Inputs/authoritative matches are never mutated.
  // offers: [{id, productKey, titleKey, title, media, protected, settled,
  //            candidates:[{id, libraryKey, strength, protected, basis}]}]
  // libraryKey is an opaque provider-record reference or a local object identity;
  // titles/ownership must NEVER be used as a substitute for library identity.
  function automaticTitleCandidate(basis) {
    const reason=String(basis||'');
    if(/\breviewed\b|user-supplied|shared (?:work|identifier|isbn|steam)|\bcontains\b|\bcomponents?\b|\bcontents?\b|\bcoverage\b/iu.test(reason))return false;
    return /related (?:complete base title|main title|title|book presentation)|subtitle|parenthetical|titles differ by an article|one (?:book )?title is a shortened or qualified presentation/iu.test(reason);
  }
  function reconcile({complete=false,offers=[]}={}) {
    const safe=complete===true && offers.length>1 && offers.every(offer=>offer.settled===true && offer.id && offer.productKey && offer.titleKey && offer.media)
      && new Set(offers.map(offer=>offer.id)).size===offers.length;
    const strong=new Map();
    if(safe)for(const offer of offers){
      if(offer.protected)continue;
      for(const candidate of offer.candidates||[]){
        if(candidate.strength!=='strong'||candidate.libraryKey==null)continue;
        const anchors=strong.get(candidate.libraryKey)||new Map();anchors.set(offer.id,offer);strong.set(candidate.libraryKey,anchors);
      }
    }
    const results=new Map();
    for(const offer of offers){
      const primary=[],deferred=[];
      for(const candidate of offer.candidates||[]){
        const titles=safe && !offer.protected && candidate.strength==='weak' && !candidate.protected && automaticTitleCandidate(candidate.basis)
          ? [...(strong.get(candidate.libraryKey)?.values()||[])].filter(anchor=>anchor.id!==offer.id && anchor.media===offer.media && anchor.productKey!==offer.productKey && anchor.titleKey!==offer.titleKey).map(anchor=>anchor.title):[];
        const competingTitles=[...new Set(titles)].sort((a,b)=>a<b?-1:a>b?1:0);
        if(competingTitles.length)deferred.push({id:candidate.id,competingTitles});else primary.push(candidate.id);
      }
      results.set(offer.id,{primary,deferred});
    }
    return {complete:safe,results};
  }
  global.BundleMatchContext=Object.freeze({reconcile});
}(globalThis));
// END SHARED BUNDLE MATCH CONTEXT

/* Purchasing summary presentation only: consumes, never changes, match states. */
(function(global) {
  const providerName = value => ({steam:'Steam',gog:'GOG',epic:'Epic Games',humble:'Humble Bundle',fanatical:'Fanatical',kindle:'Kindle',kobo:'Kobo',audible:'Audible','amazon-games':'Amazon Games'}[value] || String(value || 'another library').replaceAll('-', ' ').replace(/^./u, c=>c.toUpperCase()));
  function records(match) {
    return [match.item,match.localMatch?.item,...(match.historicalItems||[]),...(match.candidates||[]),...(match.externalMatches||[]),...(match.externalPossibleMatches||[]),...(match.externalResult?.matches||[]),...(match.externalResult?.possibleMatches||[]),...(match.externalResult?.partialMatches||[])].flat(Infinity).filter(Boolean);
  }
  function row(item, match) {
    const state = match.state === 'elsewhere' ? 'owned-elsewhere' : match.state;
    const candidates = records(match);
    const related = [...new Set(candidates.map(record=>(record.item||record).title).filter(Boolean))];
    const providers = state==='owned-elsewhere' ? [...new Set(candidates.filter(record=>record.provider).map(record=>providerName(record.provider)))] : [];
    const owned=match.range?.owned ?? match.owned ?? match.coverage?.owned;
    const total=match.range?.total ?? match.total ?? match.coverage?.total;
    return {title:item.title,state,providers,relatedTitle:related[0]||'',relatedTitles:related,
      fraction:state==='partial'&&Number.isFinite(owned)&&Number.isFinite(total)?`${owned}/${total} owned`:'',
      why:['possible','partial','unchecked'].includes(state)||Boolean(match.lookupIncomplete && state!=='owned'||match.mappingConflicts),
      ownershipReview:Boolean(match.ownershipReview)};
  }
  function summary(rows) {
    const items=rows.map(({item,match})=>row(item,match));
    const counts=Object.fromEntries(['owned','owned-elsewhere','new','partial','possible','unchecked'].map(state=>[state,items.filter(item=>item.state===state).length]));
    return {counts,items,sections:Object.keys(counts).filter(state=>counts[state]>0)};
  }
  // Display adapters only. No result objects, ownership decisions or storage are modified.
  const localProvider = "humble";
  const permanentRecord = record => ['owned','claimed'].includes(record.ownership);
  function status(item, match) {
    const state=match.state==='elsewhere'?'owned-elsewhere':match.state;
    if(state==='possible')return match.ownershipReview?'Check ownership':'Possible';
    if(state==='partial')return 'Partial';
    if(state==='unchecked')return 'Check incomplete';
    if(state==='owned-elsewhere')return 'Owned elsewhere';
    if(state==='owned')return localProvider==='humble' && [match.item].flat(Infinity).filter(Boolean).some(r=>(r.provenance?.length?r.provenance:[r]).some(p=>p.entitlement==='third-party-key')||r.kind==='game'&&r.source==='humble')?'Purchased':'Owned';
    return 'New';
  }
  function access(record, local=false) {
    const evidence=record.evidence||{};
    if(record.historical)return 'Previously recorded — current access needs review';
    if(evidence.ownershipBasis==='user-assumed-owned')return 'Treated as owned by your preference';
    const origins=record.provenance?.length?record.provenance:[record];
    if(local && origins.some(p=>p.entitlement==='third-party-key'))return 'Purchased key — activation not confirmed';
    if(record.ownership==='subscription')return 'Subscription access';
    if(record.ownership==='borrowed')return 'Borrowed access';
    if(record.ownership==='rental')return 'Rental access';
    if(record.ownership==='unknown')return 'Ownership not confirmed';
    if(local && (record.source===localProvider || origins.some(origin=>origin.purchaseKey || origin.sourceBundle || origin.bundle?.title)))return 'Purchased';
    if(permanentRecord(record))return 'Owned';
    return local?'Marked as owned locally':'Ownership not confirmed';
  }
  function readableDate(value) {
    if(!value)return '';
    const date=new Date(value);
    return Number.isNaN(date.valueOf())?'':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  const candidateFacts=new WeakMap(), bundlePriorities=new WeakMap();
  function candidateViews(item, match) {
    const entries=[], seenObjects=new Set(), seenRefs=new Set();
    const add=(values,local=false,confirmed=false,componentTitle='',exactResponse=false)=>{
      for(const wrapper of [values].flat(Infinity).filter(Boolean)){
        const record=wrapper.item||wrapper;
        if(!record.title || seenObjects.has(record))continue;
        const isLocal=local && (!record.provider || record.provider===localProvider) || !record.provider && (record.source===localProvider || Boolean(record.purchaseKey||record.sourceBundle||record.bundle));
        // Repeated references to the same response record are one card; distinct
        // accounts/access/provenance records are never merged by title.
        const ref=record.itemRef && JSON.stringify([record,wrapper.item?wrapper.reason:'']);
        if(ref && seenRefs.has(ref))continue;
        seenObjects.add(record);if(ref)seenRefs.add(ref);
        const provider=providerName(record.provider || (isLocal?localProvider:record.source||'another library'));
        const account=isLocal && (record.profileLabel||wrapper.profileLabel) ? String(record.profileLabel||wrapper.profileLabel):'';
        const basis=String(wrapper.reason||record.reason||'');
        const differences=global.HumbleOwnership.conflicts(item,record,true);
        let uncertainty='';
        if(differences.some(x=>/ISBN/iu.test(x)))uncertainty='The ISBNs differ; check which edition you want.';
        else if(differences.some(x=>/language/iu.test(x)))uncertainty='The languages differ; check before buying.';
        else if(differences.some(x=>/author/iu.test(x)))uncertainty='The author details differ; check the title and edition.';
        else if(differences.some(x=>/issue|volume|run|series|unitType/iu.test(x)))uncertainty='The series, run or numbered contents differ; check the overlap.';
        else if(differences.some(x=>/revision|edition|package/iu.test(x)) || /revision|different edition|edition\/package|version wording/iu.test(basis))uncertainty='May be a different edition or version.';
        else if(/subtitle|article|related.*title/iu.test(basis))uncertainty='The titles differ; check whether they refer to the same work.';
        const sameEdition=record.relationship==='same-edition' || confirmed && isLocal;
        const contains=record.relationship==='contains';
        const label=access(record,isLocal);
        if(!uncertainty && !sameEdition && !contains && !confirmed)uncertainty='The relationship to this offer needs review.';
        const accessNote=record.historical?'This record was not observed in the latest completed import.':
          ['subscription','rental','borrowed'].includes(record.ownership)?'Permanent ownership is not confirmed.':record.ownership==='unknown'?'Confirm ownership before buying.':'';
        const origin=isLocal?(record.provenance?.[0]||record):{};
        const purchaseDate=readableDate(origin.purchasedAt||origin.purchaseDate||record.purchasedAt||record.purchaseDate);
        const bundle=origin.sourceBundle||origin.bundle?.title||record.sourceBundle||record.bundle?.title||'';
        const context=[bundle,purchaseDate?'Purchased '+purchaseDate:''].filter(Boolean).join(' · ');
        const annotations=[];
        if(!isLocal && record.provider===localProvider)annotations.push('Central copy; compare with this extension’s current purchases.');
        if(isLocal && record.provenance?.length>1)annotations.push('Additional purchase context is in Match details.');
        if(record.evidence?.ownershipBasis==='user-assumed-owned' && record.evidence.observedOwnership)annotations.push('Original access: '+access({ownership:record.evidence.observedOwnership}));
        if(record.evidence?.ownershipBasis==='dated-manual-confirmation')annotations.push('Your ownership review'+(readableDate(record.evidence.ownershipConfirmedAt)?' on '+readableDate(record.evidence.ownershipConfirmedAt):'')+'.');
        if(record.evidence?.availability==='not-observed-in-last-full-scan')annotations.push('Not observed in the latest full scan; current availability needs review.');
        if(['expired','unavailable'].includes(record.keyStatus||record.evidence?.keyStatus))annotations.push('Purchase recorded; key '+(record.keyStatus||record.evidence.keyStatus)+'.');
        const view={title:record.title,provider,account,access:label,heading:componentTitle?'Listed component':contains?'Included contents':sameEdition?'Same title found':isLocal && label.startsWith('Purchased')?'Possibly related purchase':'Library candidate',
          relationship:componentTitle?'Compared component: '+componentTitle+'.':contains?'Contains some of the compared contents.':sameEdition?'Matches this offer.':record.relationship==='same-work'?'Related work; edition is not confirmed.':'',uncertainty,accessNote,context,annotations};
        const localResult=match.localMatch||match;
        const localExact=isLocal && confirmed && localResult.state==='owned' && !localResult.range && !localResult.ownedReason && !localResult.componentMatches?.length
          && (localProvider==='humble'||/^exact (?:normalized title|Steam App ID|ISBN)$/u.test(localResult.reason||''));
        const centralExact=!isLocal && record.relationship==='same-edition';
        const fields=localProvider==='humble'?global.HumbleComicLibrary.bibliographicFields(item):global.FanaticalLibrary.bibliographicFields(item);
        const other=localProvider==='humble'?global.HumbleComicLibrary.bibliographicFields(record.evidence||record):global.FanaticalLibrary.bibliographicFields(record.evidence||record);
        const policy=localProvider==='humble'?global.HumbleComicLibrary:global.FanaticalLibrary;
        const isbnFor=row=>[row?.externalIds?.isbn,row?.isbn,row?.isbns,row?.evidence?.isbn].flat().map(policy.validIsbn).filter(Boolean);
        const ids=isbnFor(item),otherIds=isbnFor(record);
        const sharedId=ids.some(id=>otherIds.includes(id))||['asin','editionId','steamAppId'].some(key=>(item[key]||item.externalIds?.[key])&&(item[key]||item.externalIds?.[key])===(record[key]||record.externalIds?.[key]||record.evidence?.[key]));
        candidateFacts.set(view,{libraryKey:record.itemRef?JSON.stringify([record.provider,record.itemRef]):isLocal?record:null,
          strength:!record.historical&&!differences.length&&(localExact||centralExact)?'strong':'weak',
          protected:Boolean(componentTitle||record.historical||record.relationship==='same-edition'||record.relationship==='contains'||sharedId||differences.length||fields.edition||other.edition||fields.volume||fields.issue||fields.unitType||other.volume||other.issue||other.unitType),
          basis:basis||localResult.possibleReason||localResult.reason||''});
        entries.push(view);
      }
    };
    add(match.externalMatches,false,match.state==='elsewhere'||match.state==='owned-elsewhere','',true);
    add(match.externalPossibleMatches);add(match.externalResult?.matches,false,false,'',true);add(match.externalResult?.possibleMatches);add(match.externalResult?.partialMatches);
    add(match.item,true,match.state==='owned');add(match.localMatch?.item,true,match.localMatch?.state==='owned');
    add(match.candidates,true);add(match.localMatch?.candidates,true);add(match.historicalItems,true);add(match.localMatch?.historicalItems,true);add(match.range?.items,true);add(match.localMatch?.range?.items,true);
    for(const entry of [...(match.coverage?.covered||[]),...(match.coverage?.possibleCovered||[])])add(entry.evidence);
    for(const component of match.componentMatches||[]){const title=component.offered?.title||component.item?.title||'listed component';add(component.item,true,component.state==='owned',title);add(component.externalMatches,false,false,title);add(component.externalPossibleMatches,false,false,title);add(component.externalResult?.matches,false,false,title);add(component.externalResult?.possibleMatches,false,false,title);}
    return entries;
  }

  function primaryCandidateViews(item,match) {
    const deferred=new Set((bundlePriorities.get(match)?.deferred||[]).map(entry=>entry.id));
    return candidateViews(item,match).filter((_view,index)=>!deferred.has(String(index)));
  }
  function reconcileBundle(rows,{complete=false}={}) {
    const offers=rows.map(({item,match,target,overlapProtected},index)=>{
      const media=item.kind||item.mediaType;
      const views=candidateViews(item,match);
      return {id:String(index),productKey:item.sourceItemId||global.LibraryMatchingPolicy.presentationTitle(item.lookupTitle||item.title,media),
        titleKey:global.LibraryMatchingPolicy.presentationTitle(item.lookupTitle||item.title,media),title:item.title,media,
        settled:['owned','elsewhere','owned-elsewhere','possible','partial','new'].includes(match.state)&&!match.lookupIncomplete&&!match.contentsLookupIncomplete,
        protected:Boolean(overlapProtected||target?.entries?.length||item.contents?.length||item.components?.length||match.coverage?.total||match.componentMatches?.length||/\b(?:pdf|epub|mobi|cbz|cbr|audiobook)\b/iu.test(item.format||item.title)),
        candidates:views.map((view,index)=>({id:String(index),...candidateFacts.get(view)}))};
    });
    const result=global.BundleMatchContext.reconcile({complete,offers});
    for(const [index,{match}]of rows.entries())bundlePriorities.set(match,result.results.get(String(index)));
    return {complete:result.complete,deferredCount:[...result.results.values()].reduce((total,value)=>total+value.deferred.length,0)};
  }
  function candidateCard(doc,view) {
    const card=doc.createElement('section');card.className='library-ui-candidate';
    const heading=doc.createElement('h3');heading.textContent=view.heading;card.append(heading);
    const title=doc.createElement('strong');title.textContent=view.title;card.append(title);
    const meta=doc.createElement('p');meta.className='library-ui-muted';meta.textContent=[view.provider,view.account,view.access].filter(Boolean).join(' \u00b7 ');card.append(meta);
    for(const text of [view.uncertainty||view.relationship,view.accessNote,view.context,...view.annotations].filter(Boolean)){const p=doc.createElement('p');p.textContent=text;card.append(p);}
    return card;
  }
  function renderDeferred(host,item,match) {
    const entries=bundlePriorities.get(match)?.deferred||[];if(!entries.length)return;
    const views=candidateViews(item,match),doc=host.ownerDocument;
    const cards=doc.createElement('div');cards.className='library-ui-candidates library-ui-deferred-candidates';
    for(const entry of entries){const view=views[Number(entry.id)];if(!view)continue;const card=candidateCard(doc,view);const note=doc.createElement('p');note.textContent='More closely matches another item in this bundle: '+entry.competingTitles.join('; ')+'.';card.append(note);cards.append(card);}
    host.append(cards);
  }

  function conclusion(item,match) {
    const view=row(item,match);
    if(view.state==='unchecked')return 'Galactic Library could not finish checking. No local match was found; retry before treating this item as new.';
    if(view.state==='partial')return (match.componentMatches?.length?'Some listed components are already in your library':'Some known contents are already in your library')+(view.fraction?' ('+view.fraction+')':'')+'. Check what remains; this does not establish ownership of the whole edition.';
    if(view.state==='possible') {
      if(candidateViews(item,match).length&&!primaryCandidateViews(item,match).length)return 'A related library item more closely matches another offer in this bundle. Review it in Match details before buying.';
      const sameTitleAccess=primaryCandidateViews(item,match).find(candidate=>candidate.heading==='Same title found' && ['Subscription access','Borrowed access','Rental access'].includes(candidate.access));
      if(match.ownershipReview && sameTitleAccess)return 'You have '+sameTitleAccess.access.toLowerCase()+' to a matching title, but permanent ownership is not confirmed.';
      return match.ownershipReview?'A library item needs an ownership check. Review its access and any related editions before buying.':'A related library item was found. Check the edition or included contents before buying.';
    }
    if(view.state==='owned-elsewhere')return 'A linked library records a matching item as owned.';
    if(view.state==='owned')return status(item,match)==='Purchased'?'This item is in your local purchases. A purchased key does not confirm activation.':'This item is marked as owned in your local library.';
    return 'No match was found in the available library data.';
  }
  function tooltip(item,match) {
    const candidates=primaryCandidateViews(item,match);
    return [status(item,match),conclusion(item,match),...candidates.slice(0,2).map(c=>c.title+' · '+c.provider+' · '+c.access),candidates.length>2?'+'+(candidates.length-2)+' more candidates':'','Open the explanation for candidates and match details.'].filter(Boolean).join('\n');
  }
  function relatedCaption(item,match) {
    const candidates=primaryCandidateViews(item,match);if(!candidates.length)return bundlePriorities.get(match)?.deferred.length?'Related candidate in Match details; closer match elsewhere in this bundle.':'';
    const first=candidates[0];
    return first.title+' · '+first.provider+' · '+first.access+(candidates.length>1?' · +'+(candidates.length-1)+' more':'');
  }
  function renderCandidates(host,item,match) {
    const doc=host.ownerDocument;
    const primary=doc.createElement('strong');primary.className='library-ui-match-status';primary.textContent=status(item,match);host.insertBefore(primary,host.querySelector('.hcl-explanation, .fanatical-library-explanation'));
    const cards=doc.createElement('div');cards.className='library-ui-candidates';
    for(const view of primaryCandidateViews(item,match))cards.append(candidateCard(doc,view));
    if(cards.children.length)host.append(cards);
    if(bundlePriorities.get(match)?.deferred.length){const note=doc.createElement('p');note.className='library-ui-muted';note.textContent='Related candidates that more closely match another bundle item are in Match details.';host.append(note);}
    if(match.lookupIncomplete||match.contentsLookupIncomplete){const note=doc.createElement('p');note.className='library-ui-warning';note.textContent='Some checks are incomplete. These results include available evidence; missing results do not prove an item is new.';host.append(note);}
    if(match.coverage?.scopeUncertain){const note=doc.createElement('p');note.textContent='The contents comparison needs series/run or language confirmation.';host.append(note);}
  }

  global.HumbleOwnership.presentation={providerName,records,row,summary,explanation:conclusion,status,access,candidateViews,tooltip,relatedCaption,renderCandidates,primaryCandidateViews,reconcileBundle,renderDeferred};
}(globalThis));
