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
    const mappings = rows.map((row, index) => {
      if (!row || typeof row.collectionTitle !== 'string' || !row.collectionTitle.trim()) {
        throw new Error(`Mapping ${index + 1} needs a collectionTitle.`);
      }
      if (!Array.isArray(row.contains) || !row.contains.length) {
        throw new Error(`Mapping ${index + 1} needs at least one contains entry.`);
      }
      const contains = row.contains.map((entry, entryIndex) => {
        const series = String(entry?.series ?? '').trim();
        const year = Number(entry?.year);
        const from = Number(entry?.from);
        const to = Number(entry?.to);
        if (!series || !Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 10000) {
          throw new Error(`Mapping ${index + 1}, contains entry ${entryIndex + 1} needs a series, year, and valid issue range.`);
        }
        return { series, year, from, to };
      });
      return {
        id: String(row.id ?? `custom-${index + 1}`).trim() || `custom-${index + 1}`,
        collectionTitle: row.collectionTitle.trim(),
        sourceLabel: String(row.sourceLabel ?? 'Custom mapping').trim() || 'Custom mapping',
        contains
      };
    });
    const ids = new Set();
    for (const mapping of mappings) {
      if (ids.has(mapping.id)) throw new Error(`Duplicate mapping id: ${mapping.id}`);
      ids.add(mapping.id);
    }
    return mappings;
  }

  global.HumbleCollectionMappings = { builtIn, validateCustomMappings };
}(globalThis));
