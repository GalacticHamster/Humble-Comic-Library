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
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/&/gu, ' and ')
      .replace(FORMAT_WORDS, ' ')
      .replace(PRESENTATION_WORDS, ' ')
      .replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ')
      .replace(/[’'`]/gu, '')
      .replace(/[^a-z0-9]+/gu, ' ')
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
      sourceBundle: String(row.sourceBundle ?? '').trim()
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

  const BACKUP_VERSION = 6;
  const LIBRARY_STATE_DEFAULTS = {
    libraryItems: [], purchaseSummaries: [], customCollectionMappings: [],
    keyReminders: [], keyReminderScan: null, lastImport: null, mediaImportVersion: 1
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

  function restoreBackupItem(value, label) {
    if (typeof value === 'string') {
      const item = normalizeLibraryImportItem(value);
      if (!item) throw new Error(`${label} needs a title.`);
      return item;
    }
    const item = backupRecord(value, { ...PROVENANCE_FIELDS, kind: 'string', source: 'string' }, label, ['title']);
    if (item.kind !== undefined && !LIBRARY_ITEM_KINDS.has(item.kind)) throw new Error(`${label}.kind is unsupported.`);
    if (value.provenance !== undefined) {
      item.provenance = backupArray(value.provenance, `${label}.provenance`, (record, path) => backupRecord(record, PROVENANCE_FIELDS, path));
    }
    return item;
  }

  function restoreBackupState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isInteger(value.version) || value.version < 1 || value.version > BACKUP_VERSION) {
      throw new Error('Choose a supported Humble Comic Library backup, not a manual title list.');
    }
    if (value.version === BACKUP_VERSION) {
      for (const field of ['items', 'purchases', 'collectionMappings', 'keyReminders', 'keyReminderScan', 'lastImport', 'mediaImportVersion']) {
        if (!Object.hasOwn(value, field)) throw new Error(`Backup is missing ${field}.`);
      }
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
      pricedPurchases: 'number', skippedPurchases: 'number'
    }, 'lastImport');
    const mediaImportVersion = value.mediaImportVersion === undefined ? 1 : value.mediaImportVersion;
    if (!Number.isInteger(mediaImportVersion) || mediaImportVersion < 1 || mediaImportVersion > 6) {
      throw new Error('Unsupported media import scan version.');
    }
    const customCollectionMappings = global.HumbleCollectionMappings.validateCustomMappings(value.collectionMappings === undefined ? [] : value.collectionMappings);
    return { libraryItems, purchaseSummaries, keyReminders, keyReminderScan, lastImport, mediaImportVersion, customCollectionMappings };
  }

  function createLibraryBackup(state, exportedAt = new Date().toISOString()) {
    const saved = { ...LIBRARY_STATE_DEFAULTS, ...state };
    return {
      version: BACKUP_VERSION, exportedAt, items: saved.libraryItems, purchases: saved.purchaseSummaries,
      collectionMappings: saved.customCollectionMappings, keyReminders: saved.keyReminders,
      keyReminderScan: saved.keyReminderScan, lastImport: saved.lastImport, mediaImportVersion: saved.mediaImportVersion
    };
  }

  function manualTitleImportState(value) {
    if (!Array.isArray(value) && (!value || typeof value !== 'object'
      || ['version', 'purchases', 'keyReminders', 'keyReminderScan', 'lastImport', 'mediaImportVersion', 'collectionMappings'].some((field) => Object.hasOwn(value, field)))) {
      throw new Error('Use Restore backup for exported backups. Import titles accepts a manual title list.');
    }
    const rows = Array.isArray(value) ? value : value.items;
    if (!Array.isArray(rows)) throw new Error('Expected a JSON title array or an object with an items array.');
    const unique = new Map();
    for (const row of rows) {
      const item = normalizeLibraryImportItem(row);
      if (!item) throw new Error('Every title-list entry needs a nonempty title.');
      unique.set(`${item.kind ?? 'book'}:${titleKey(item.title)}`, item);
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
    normalizeTitle, titleKey, normalizeLibraryImportItem, uniqueStrings, isExtensionId,
    LIBRARY_STATE_DEFAULTS, createLibraryBackup, restoreBackupState, manualTitleImportState
  };
}(globalThis));
