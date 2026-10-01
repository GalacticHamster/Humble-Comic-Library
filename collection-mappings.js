(function attachCollectionMappings(global) {
  'use strict';

  // These rules describe publicly documented collected editions. They never
  // add a title to a library: a rule only applies when its collection title is
  // already present in the user's browser-local Humble library.
  const builtIn = [
    {
      id: 'valiant-masters-rai-1992-1-8',
      collectionTitle: 'Valiant Masters Rai: From Honor To Strength',
      sourceLabel: 'Valiant Entertainment',
      sourceUrl: 'https://valiantentertainment.com/comics/no-title/valiant-masters-rai-vol-1-from-honor-to-strength-hc/',
      contains: [{ series: 'Rai', year: 1992, from: 1, to: 8 }]
    }
  ];

  function validateCustomMappings(value) {
    const rows = Array.isArray(value) ? value : value?.mappings;
    if (!Array.isArray(rows)) throw new Error('Expected an array or an object with a mappings array.');
    if (rows.length > 5000) throw new Error('Too many collection mappings (maximum 5,000).');
    const mappings = rows.map((row, index) => {
      if (!row || typeof row.collectionTitle !== 'string' || !row.collectionTitle.trim()) {
        throw new Error(`Mapping ${index + 1} needs a collectionTitle.`);
      }
      if (!Array.isArray(row.contains) || !row.contains.length) {
        throw new Error(`Mapping ${index + 1} needs at least one contains entry.`);
      }
      if (row.contains.length > 2000) throw new Error(`Mapping ${index + 1} contains too many entries.`);
      const contains = row.contains.map(entry => validateEntry(entry));
      const result = {
        id: bounded(row.id ?? `custom-${index + 1}`) || `custom-${index + 1}`,
        collectionTitle: bounded(row.collectionTitle),
        sourceLabel: bounded(row.sourceLabel ?? 'Custom mapping') || 'Custom mapping',
        contains
      };
      for (const key of ['editionId', 'sourceId', 'language']) {
        if (row[key] !== undefined) result[key] = bounded(row[key], key === 'language' ? 80 : 500);
      }
      if (row.identifiers !== undefined) {
        const fields = global.HumbleComicLibrary.bibliographicFields(row.identifiers);
        if (!fields.isbn?.length && !fields.asin) throw new Error(`Mapping ${index + 1} needs a validated ISBN or ASIN.`);
        result.identifiers = { ...(fields.isbn ? { isbn: fields.isbn } : {}), ...(fields.asin ? { asin: fields.asin } : {}) };
      }
      if (row.sourceUrl !== undefined) {
        const url = new URL(row.sourceUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Mapping sourceUrl must be an HTTP(S) page.');
        result.sourceUrl = `${url.origin}${url.pathname}`;
      }
      if (row.verifiedAt !== undefined) {
        if (typeof row.verifiedAt !== 'string' || Number.isNaN(Date.parse(row.verifiedAt))) throw new Error('Mapping verifiedAt must be a valid date.');
        result.verifiedAt = row.verifiedAt;
      }
      for (const key of ['verified', 'contentsComplete']) {
        if (row[key] !== undefined) {
          if (typeof row[key] !== 'boolean') throw new Error(`Mapping ${key} must be boolean.`);
          result[key] = row[key];
        }
      }
      // Expanding here validates the bound before anything enters storage.
      expandContents(result);
      return result;
    });
    const ids = new Set();
    for (const mapping of mappings) {
      if (ids.has(mapping.id)) throw new Error(`Duplicate mapping id: ${mapping.id}`);
      ids.add(mapping.id);
    }
    return mappings;
  }

  function bounded(value, max = 500) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Contents fields must be text or numbers.');
    const result = String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (result.length > max) throw new Error('Contents field is too long.');
    return result;
  }

  function validateEntry(entry) {
    const series = bounded(entry?.series ?? '');
    if (!series) throw new Error('Each contains entry needs a series.');
    const result = { series };
    if (entry.year !== undefined) {
      const year = Number(entry.year);
      if (!Number.isInteger(year) || year < 1800 || year > 2200) throw new Error('Invalid series year.');
      result.year = year;
    }
    for (const key of ['seriesId', 'runId', 'run', 'language']) if (entry[key] !== undefined) result[key] = bounded(entry[key], key === 'language' ? 80 : 500);
    const unitType = entry.unitType ?? 'issue';
    if (!['issue', 'volume', 'annual', 'special', 'component'].includes(unitType)) throw new Error('Unsupported contents unit type.');
    if (entry.unitType !== undefined) result.unitType = unitType;
    const completeness = entry.completeness ?? 'full';
    if (!['full', 'excerpt'].includes(completeness)) throw new Error('Contents completeness must be full or excerpt.');
    if (entry.completeness !== undefined) result.completeness = completeness;
    if (entry.number !== undefined) {
      const number = bounded(entry.number, 80);
      if (!number || (['issue', 'volume', 'annual'].includes(unitType) && (!/^(?:\d{1,6}\/\d{1,6}|\d{1,6}(?:\.\d{1,6})?)$/u.test(number) || /\/0+$/u.test(number)))) throw new Error('Invalid unit number.');
      result.number = number;
    } else {
      const from = Number(entry.from); const to = Number(entry.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 10000 || to - from > 1999) throw new Error('Invalid or excessive issue/volume range.');
      result.from = from; result.to = to;
    }
    if (!result.run && result.year === undefined && !result.runId) throw new Error('Contents need a series run, year, or runId.');
    return result;
  }

  function expandContents(mapping) {
    const entries = [];
    for (const raw of mapping.contains ?? []) {
      const entry = validateEntry(raw);
      const numbers = entry.number !== undefined ? [entry.number]
        : Array.from({ length: entry.to - entry.from + 1 }, (_, n) => String(entry.from + n));
      for (const number of numbers) entries.push({
        series: entry.series, run: entry.run || (entry.year !== undefined ? String(entry.year) : ''),
        unitType: entry.unitType || 'issue', number,
        language: (entry.language || mapping.language || '').toLowerCase(), completeness: entry.completeness || 'full',
        ...(entry.seriesId ? { seriesId: entry.seriesId } : {}), ...(entry.runId ? { runId: entry.runId } : {})
      });
      if (entries.length > 2000) throw new Error('A collection may enumerate at most 2,000 units.');
    }
    return entries;
  }

  function numberKey(value) {
    const number = String(value); const fraction = /^(\d+)\/(\d+)$/u.exec(number);
    return fraction ? String(Number(fraction[1]) / Number(fraction[2]))
      : /^\d+(?:\.\d+)?$/u.test(number) ? String(Number(number)) : number;
  }

  function scopeKey(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function contentKey(entry) {
    return JSON.stringify([scopeKey(entry.series), scopeKey(entry.run), entry.unitType, numberKey(entry.number), scopeKey(entry.language)]);
  }

  function mappingMatches(mapping, item) {
    if (mapping.verified === false || global.HumbleComicLibrary.titleKey(mapping.collectionTitle) !== global.HumbleComicLibrary.titleKey(item.title)) return false;
    const identity = global.HumbleComicLibrary.bibliographicFields(item);
    if (mapping.editionId && identity.editionId !== mapping.editionId) return false;
    if (mapping.identifiers?.isbn?.length && !identity.isbn?.some(isbn => mapping.identifiers.isbn.includes(isbn))) return false;
    if (mapping.identifiers?.asin && identity.asin !== mapping.identifiers.asin) return false;
    if (mapping.language && identity.language && scopeKey(mapping.language) !== scopeKey(identity.language)) return false;
    return true;
  }

  function titleContents(title, metadata = {}) {
    const label = String(title ?? '').replace(/\b(?:preview|sample|read\s+now)\b/giu, '').replace(/\s+/gu, ' ').trim();
    const match = /^(.*?)\s*(?:(vol(?:ume)?s?\.?|books?)\s*|(#)\s*)(\d+\/\d+|\d+(?:\.\d+)?)(?:\s*[-\u2013\u2014]\s*#?(\d+))?\s*$/iu.exec(label);
    if (!match || !match[1].trim()) return [];
    let series = match[1].trim(); let unitType = match[3] ? 'issue' : 'volume';
    const trailingYear = /\s*\((\d{4})\)\s*$/u.exec(series);
    if (trailingYear) series = series.slice(0, trailingYear.index).trim();
    if (/\bannual$/iu.test(series)) { series = series.replace(/\s*annual$/iu, ''); unitType = 'annual'; }
    if (/\bspecial$/iu.test(series)) { series = series.replace(/\s*special$/iu, ''); unitType = 'special'; }
    const year = /\s*\((\d{4})\)\s*$/u.exec(series);
    const run = metadata.run || trailingYear?.[1] || (year ? year[1] : '');
    if (year) series = series.slice(0, year.index).trim();
    const first = match[4]; const last = match[5];
    if (last && (!/^\d+$/u.test(first) || Number(last) < Number(first) || Number(last) - Number(first) > 1999)) return [];
    return (last ? Array.from({ length: Number(last) - Number(first) + 1 }, (_, n) => String(Number(first) + n)) : [first])
      .map(number => ({ series, run, unitType, number, language: (metadata.language || '').toLowerCase(), completeness: 'full', ...(metadata.seriesId ? { seriesId: metadata.seriesId } : {}), ...(metadata.runId ? { runId: metadata.runId } : {}) }));
  }

  global.HumbleCollectionMappings = { builtIn, validateCustomMappings, expandContents, numberKey, scopeKey, contentKey, mappingMatches, titleContents };
}(globalThis));
