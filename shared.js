/* Global helpers shared by the options page and Humble page overlay. */
(function attachHumbleLibraryHelpers(global) {
  'use strict';

  const FORMAT_WORDS = /\b(?:pdf|cbz|cbr|epub|mobi|kindle|digital\s+edition)\b/giu;
  const PRESENTATION_WORDS = /\b(?:preview|sample|read\s+now)\b/giu;
  const LIBRARY_ITEM_KINDS = new Set(['book', 'game', 'software', 'audiobook']);
  const ROMAN_NUMERALS = new Map([
    ['i', '1'], ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'],
    ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10']
  ]);

  function normalizeTitle(value) {
    let normalized = String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/&/gu, ' and ')
      .replace(FORMAT_WORDS, ' ')
      .replace(PRESENTATION_WORDS, ' ')
      .replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ')
      .replace(/[’'`]/gu, '')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .trim();

    normalized = normalized.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, (match) => ROMAN_NUMERALS.get(match) ?? match);
    return normalized.replace(/\s+/gu, ' ');
  }

  function titleKey(value) {
    return normalizeTitle(value)
      .replace(/\b(?:the|a|an)\b/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  function normalizeLibraryImportItem(value) {
    const row = typeof value === 'string' ? { title: value } : value;
    if (!row || typeof row.title !== 'string' || !row.title.trim()) return null;
    const item = {
      title: row.title.trim(),
      sourceBundle: String(row.sourceBundle ?? '').trim(),
      ...bibliographicFields(row)
    };
    const kind = String(row.kind ?? '').trim().toLowerCase();
    // Older manual libraries have no kind and remain compatible as books.
    // Preserve only recognized kinds from an extension backup so malformed
    // input cannot create a category the comparison UI does not understand.
    if (LIBRARY_ITEM_KINDS.has(kind)) item.kind = kind;
    return item;
  }

  function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function text(value, limit = 500) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, limit) : '';
  }

  function names(value) {
    return uniqueStrings((Array.isArray(value) ? value : [value])
      .map(entry => text(typeof entry === 'object' ? entry?.name : entry))).slice(0, 50);
  }

  function validIsbn(value) {
    const isbn = text(value).toUpperCase().replace(/[-\s]/gu, '');
    if (/^\d{9}[\dX]$/u.test(isbn)) {
      if ([...isbn].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11) return '';
      const base = `978${isbn.slice(0, 9)}`;
      return base + ((10 - [...base].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10);
    }
    if (!/^97[89]\d{10}$/u.test(isbn)) return '';
    return [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : '';
  }

  // Catalog fields only. Purchase identifiers, keys and download URLs are never
  // copied into bibliographic requests or mapping evidence.
  function bibliographicFields(value) {
    const raw = value?.metadata ?? value ?? {};
    const fields = {};
    const authors = names(raw.authors ?? raw.author);
    const isbn = names(raw.isbn ?? raw.isbns ?? raw.isbn13 ?? raw.isbn10).map(validIsbn).filter(Boolean);
    if (authors.length) fields.authors = authors;
    if (isbn.length) fields.isbn = uniqueStrings(isbn);
    for (const key of ['asin', 'workId', 'editionId', 'edition', 'language', 'series', 'seriesId', 'run', 'runId', 'volume', 'issue', 'unitType']) {
      const entry = text(raw[key]);
      if (entry) fields[key] = key === 'language' ? entry.toLowerCase() : entry;
    }
    return fields;
  }

  function catalogItemKey(item) {
    const fields = bibliographicFields(item);
    const identity = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, Array.isArray(value) ? [...value].sort() : value]));
    return `${item.kind ?? 'book'}:${normalizeTitle(item.title)}${Object.keys(identity).length ? `:${JSON.stringify(identity)}` : ''}`;
  }

  function normalizeWishlist(value) {
    if (!Array.isArray(value) || value.length > 5000) throw new Error('Wishlist must contain at most 5,000 items.');
    const rows = value.map(row => {
      const item = normalizeLibraryImportItem(row);
      if (!item || item.title.length > 500) throw new Error('Each wishlist entry needs a title of at most 500 characters.');
      const kind = typeof row === 'string' ? 'book' : row.kind ?? 'book';
      if (!LIBRARY_ITEM_KINDS.has(kind)) throw new Error('Unsupported wishlist media type.');
      const weight = typeof row === 'string' ? 1 : row.weight ?? 1;
      if (!Number.isInteger(weight) || weight < 1 || weight > 100) throw new Error('Wishlist priority must be an integer from 1 to 100.');
      return { title: item.title, kind, weight, ...bibliographicFields(item) };
    });
    return [...new Map(rows.map(item => [catalogItemKey(item), item])).values()];
  }

  const BACKUP_VERSION = 8;
  const LIBRARY_STATE_DEFAULTS = {
    libraryItems: [], purchaseSummaries: [], customCollectionMappings: [],
    keyReminders: [], keyReminderScan: null, lastImport: null, mediaImportVersion: 1,
    historicalLibraryItems: [], historicalPurchaseSummaries: []
  };

  function backupRecord(value, fields, label, required = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const result = {};
    for (const [name, type] of Object.entries(fields)) {
      if (value[name] === undefined) continue;
      const field = value[name];
      if (field === null && type.endsWith('?')) result[name] = null;
      else if (typeof field === type.replace('?', '') && (typeof field !== 'number' || Number.isFinite(field))) result[name] = field;
      else throw new Error(`${label}.${name} has an invalid value.`);
    }
    for (const name of required) {
      if (typeof result[name] !== 'string' || !result[name].trim()) throw new Error(`${label}.${name} is required.`);
    }
    return result;
  }

  function backupArray(value, label, convert) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    return value.map((record, index) => convert(record, `${label}[${index}]`));
  }

  const PROVENANCE_FIELDS = { title: 'string', sourceBundle: 'string', purchaseKey: 'string', purchasedAt: 'string?' };

  function entitlementFields(value) {
    const result = {};
    for (const field of ['entitlement', 'entitlementId', 'keyType', 'keyStatus', 'expiresAt', 'keyCheckedAt']) {
      if (!Object.hasOwn(value, field)) continue;
      const entry = value[field];
      if (['expiresAt', 'keyCheckedAt'].includes(field) && entry === null) { result[field] = null; continue; }
      if (typeof entry !== 'string' || entry.length > 500) throw new Error(`Invalid entitlement ${field}.`);
      if (field === 'entitlement' && !['direct-download', 'third-party-key'].includes(entry)
        || field === 'keyStatus' && !['unknown', 'unrevealed', 'revealed', 'expired', 'unavailable'].includes(entry)
        || ['expiresAt', 'keyCheckedAt'].includes(field) && (!/^\d{4}-\d{2}-\d{2}T/iu.test(entry) || !Number.isFinite(Date.parse(entry)))) throw new Error(`Invalid entitlement ${field}.`);
      result[field] = entry;
    }
    return result;
  }

  function restoreBackupItem(value, label) {
    if (typeof value === 'string') {
      const item = normalizeLibraryImportItem(value);
      if (!item) throw new Error(`${label} needs a title.`);
      return item;
    }
    const item = { ...backupRecord(value, { ...PROVENANCE_FIELDS, kind: 'string', source: 'string' }, label, ['title']), ...bibliographicFields(value), ...entitlementFields(value) };
    if (item.kind !== undefined && !LIBRARY_ITEM_KINDS.has(item.kind)) throw new Error(`${label}.kind is unsupported.`);
    if (value.provenance !== undefined) {
      item.provenance = backupArray(value.provenance, `${label}.provenance`, (record, path) => ({...backupRecord(record, PROVENANCE_FIELDS, path), ...entitlementFields(record)}));
    }
    return item;
  }

  function restoreBackupState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isInteger(value.version) || value.version < 1 || value.version > BACKUP_VERSION) {
      throw new Error('Choose a supported Humble Comic Library backup, not a manual title list.');
    }
    if (value.version >= 6) {
      for (const field of ['items', 'purchases', 'collectionMappings', 'keyReminders', 'keyReminderScan', 'lastImport', 'mediaImportVersion']) {
        if (!Object.hasOwn(value, field)) throw new Error(`Backup is missing ${field}.`);
      }
    }
    if (value.version >= 7 && (!Object.hasOwn(value, 'historicalItems') || !Object.hasOwn(value, 'historicalPurchases'))) {
      throw new Error('Backup is missing historical purchase evidence.');
    }
    const libraryItems = backupArray(value.items, 'items', restoreBackupItem);
    const purchaseSummaries = backupArray(value.purchases === undefined ? [] : value.purchases, 'purchases', (record, path) => backupRecord(record, {
      purchaseKey: 'string', sourceBundle: 'string', purchasedAt: 'string?', itemCount: 'number',
      pricePaid: 'number?', currency: 'string?', pricePerItem: 'number?'
    }, path, ['purchaseKey']));
    const keyReminders = backupArray(value.keyReminders === undefined ? [] : value.keyReminders, 'keyReminders', (record, path) => {
      const reminder = backupRecord(record, {
        id: 'string', purchaseKey: 'string', title: 'string', sourceBundle: 'string', purchasedAt: 'string?',
        keyType: 'string', status: 'string', directRedeem: 'boolean', isExpired: 'boolean',
        expiresAt: 'string?', daysUntilExpiry: 'number?', checkedAt: 'string'
      }, path, ['id', 'purchaseKey', 'title']);
      if (!['unrevealed', 'needs-review'].includes(reminder.status)) throw new Error(`${path}.status is unsupported.`);
      return reminder;
    });
    let keyReminderScan = null;
    if (value.keyReminderScan != null) {
      keyReminderScan = backupRecord(value.keyReminderScan, { complete: 'boolean', checkedAt: 'string' }, 'keyReminderScan');
      if (typeof keyReminderScan.complete !== 'boolean') throw new Error('keyReminderScan.complete is required.');
      for (const field of ['purchaseKeys', 'baselinePurchaseKeys', 'failedPurchaseKeys']) {
        if (value.keyReminderScan[field] !== undefined) {
          keyReminderScan[field] = backupArray(value.keyReminderScan[field], `keyReminderScan.${field}`, (key, path) => {
            if (typeof key !== 'string' || !key.trim()) throw new Error(`${path} needs a purchase identifier.`);
            return key;
          });
        }
      }
    }
    const lastImport = value.lastImport == null ? null : backupRecord(value.lastImport, {
      importedAt: 'string', scannedPurchases: 'number', skippedKnown: 'number', addedTitles: 'number',
      addedGames: 'number', addedSoftware: 'number', addedAudiobooks: 'number', datesBackfilled: 'number',
      pricedPurchases: 'number', skippedPurchases: 'number', fullRescan: 'boolean', reconciled: 'boolean'
    }, 'lastImport');
    if (lastImport && value.lastImport.failedPurchaseKeys !== undefined) {
      lastImport.failedPurchaseKeys = backupArray(value.lastImport.failedPurchaseKeys, 'lastImport.failedPurchaseKeys', (key, path) => {
        if (typeof key !== 'string' || !key.trim()) throw new Error(`${path} needs a purchase identifier.`);
        return key;
      });
    }
    const mediaImportVersion = value.mediaImportVersion === undefined ? 1 : value.mediaImportVersion;
    if (!Number.isInteger(mediaImportVersion) || mediaImportVersion < 1 || mediaImportVersion > 7) {
      throw new Error('Unsupported media import scan version.');
    }
    const customCollectionMappings = global.HumbleCollectionMappings.validateCustomMappings(value.collectionMappings === undefined ? [] : value.collectionMappings);
    const historicalLibraryItems = backupArray(value.historicalItems === undefined ? [] : value.historicalItems, 'historicalItems', restoreBackupItem);
    const historicalPurchaseSummaries = backupArray(value.historicalPurchases === undefined ? [] : value.historicalPurchases, 'historicalPurchases', (record, path) => backupRecord(record, {
      purchaseKey: 'string', sourceBundle: 'string', purchasedAt: 'string?', itemCount: 'number',
      pricePaid: 'number?', currency: 'string?', pricePerItem: 'number?'
    }, path, ['purchaseKey']));
    return { libraryItems, purchaseSummaries, keyReminders, keyReminderScan, lastImport, mediaImportVersion, customCollectionMappings, historicalLibraryItems, historicalPurchaseSummaries };
  }

  function createLibraryBackup(state, exportedAt = new Date().toISOString()) {
    const saved = { ...LIBRARY_STATE_DEFAULTS, ...state };
    return {
      version: BACKUP_VERSION, exportedAt, items: saved.libraryItems, purchases: saved.purchaseSummaries,
      collectionMappings: saved.customCollectionMappings, keyReminders: saved.keyReminders,
      keyReminderScan: saved.keyReminderScan, lastImport: saved.lastImport, mediaImportVersion: saved.mediaImportVersion,
      historicalItems: saved.historicalLibraryItems, historicalPurchases: saved.historicalPurchaseSummaries
    };
  }

  function manualTitleImportState(value) {
    if (!Array.isArray(value) && (!value || typeof value !== 'object'
      || ['version', 'purchases', 'keyReminders', 'keyReminderScan', 'lastImport', 'mediaImportVersion', 'collectionMappings', 'historicalItems', 'historicalPurchases'].some((field) => Object.hasOwn(value, field)))) {
      throw new Error('Use Restore backup for exported backups. Import titles accepts a manual title list.');
    }
    const rows = Array.isArray(value) ? value : value.items;
    if (!Array.isArray(rows)) throw new Error('Expected a JSON title array or an object with an items array.');
    const unique = new Map();
    for (const row of rows) {
      const item = normalizeLibraryImportItem(row);
      if (!item) throw new Error('Every title-list entry needs a nonempty title.');
      unique.set(catalogItemKey(item), item);
    }
    return { ...LIBRARY_STATE_DEFAULTS, libraryItems: [...unique.values()], hclPurchaseFocus: null };
  }

  function isExtensionId(value) {
    const id = String(value ?? '').trim();
    const chromeId = /^[a-p]{32}$/u;
    // AMO uses email-style Gecko IDs. Require a non-empty local part and a
    // dotted DNS-like domain rather than accepting arbitrary text.
    const geckoId = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;
    return chromeId.test(id) || geckoId.test(id);
  }

  global.HumbleComicLibrary = {
    normalizeTitle, titleKey, normalizeLibraryImportItem, uniqueStrings, isExtensionId, catalogItemKey, normalizeWishlist, entitlementFields,
    LIBRARY_STATE_DEFAULTS, createLibraryBackup, restoreBackupState, manualTitleImportState,
    text, names, validIsbn, bibliographicFields
  };
}(globalThis));
