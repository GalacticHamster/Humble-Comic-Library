// BEGIN SHARED MATCHING POLICY
(function installLibraryMatchingPolicy(global) {
  'use strict';
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  function presentationTitle(value, kind = 'book') {
    let title = String(value ?? '').normalize('NFKC').toLowerCase().trim();
    if (kind === 'book') {
      const format = /\s+(?:\(digital\)|(?:[\[(]\s*)?(?:pdf|cbz|cbr|epub|mobi|kindle|tp|tpb|hc|hardcover|paperback|trade paperback|digital edition)(?:\s*[\])])?)\s*$/iu;
      while (format.test(title)) title = title.replace(format, '').trim();
      // A format token before a labeled volume is store presentation, not a subtitle.
      title = title.replace(/\s+tpb?\s+(?=vol(?:ume)?\.?\s+\d+\b)/gu, ' ');
    }
    title = title.replace(/&/gu, ' and ').replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ')
      .replace(/['\u2018\u2019\u0060]/gu, '')
      .replace(/\d+(?:[.\-\u2013\u2014]\d+)+|[^\p{L}\p{N}\p{M}+#/]+/gu,
        part => /^\d/u.test(part) ? part.replace(/[\u2013\u2014]/gu, '-') : ' ')
      .replace(/\b(vol|issue)\s+(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, (_match, unit, number) => unit + ' ' + roman[number])
      .replace(/\s+/gu, ' ').trim();
    // Limit zero padding to explicitly labeled whole book volumes.
    if (kind === 'book') {
      title = title.replace(/\bvol\s+0+(\d+)(?=\s|$)/gu, 'vol $1');
      // Only a leading article in a distinctive, explicitly numbered series is
      // presentation-equivalent. Short/generic and unnumbered works stay literal.
      const numbered = /^(?:the|a|an) (.+?) vol \d+(?= |$)/u.exec(title);
      if (numbered) {
        const generic = new Set(['the','a','an','and','of','in','to','for','with','book','books','guide','manual','introduction','collection','complete','edition','story','stories']);
        const words = new Set(numbered[1].split(' ').filter(word => /^\p{L}{3,}$/u.test(word) && !generic.has(word)));
        if (words.size >= 2 || [...words].some(word => word.length >= 8)) title = title.replace(/^(?:the|a|an) /u, '');
      }
    }
    return title;
  }
  function ownershipTitleKeys(title, kind = 'book') {
    const keys = [presentationTitle(title, kind)];
    if (kind === 'book' && /\s*\(plus extra content\)\s*$/iu.test(title)) {
      keys.push(presentationTitle(String(title).replace(/\s*\(plus extra content\)\s*$/iu, ''), kind));
    }
    return [...new Set(keys.filter(Boolean))];
  }
  function fullTitleMatches(offered, stored, kind = 'book') {
    const key = presentationTitle(offered, kind);
    return Boolean(key && ownershipTitleKeys(stored, kind).includes(key));
  }
  function relatedPresentationReason(left, right, kind = 'book') {
    const a = presentationTitle(left, kind), b = presentationTitle(right, kind);
    if (!a || !b || a === b) return '';
    const articles = value => value.replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (articles(a) && articles(a) === articles(b)) return 'The titles differ by an article; compare the library title.';
    const accents = value => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC');
    if (accents(a) === accents(b)) return 'The titles differ in accents; identity needs review.';
    const numbering = value => value.replace(/(?<=\d)[.\-/](?=\d)/gu, ' ');
    if (numbering(a) === numbering(b)) return 'Numbering punctuation differs; review the library item.';
    const numerals = value => value.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, word => roman[word]);
    if (numerals(a) === numerals(b)) return 'The titles differ in general Roman numeral wording; identity needs review.';
    return '';
  }
  function relatedTitleKeys(value, kind = 'book') {
    const title = presentationTitle(value, kind);
    return [...new Set([
      title.replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim(),
      title.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC'),
      title.replace(/(?<=\d)[.\-/](?=\d)/gu, ' '),
      title.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, word => roman[word])
    ].filter(Boolean))].map(key => 'presentation:' + key);
  }
  // Discovery only: these parts never supply exact-title or edition identity.
  // Prefer explicit structure/semantic markers to a list of accepted titles.
  function revisionTitleParts(value, kind = 'book') {
    const title = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const result = (base, qualifier = '') => ({base, qualifier});
    if (!['book', 'audiobook', 'software'].includes(kind)) return result(title);
    const marker = /\b(?:edition|ed\.?|revision|rev\.?|revised|updated|expanded|annotated|abridged|unabridged|version|release|printing|print|reprint|format|paperback|hardcover|hardback|softcover|ebook|e-book|digital|pdf|epub|mobi|cbz|cbr)\b|\b\d+e\b|\bv\d+(?:\.\d+)*\b/iu;
    // Delimiters identify the base even when an edition description is new.
    const bracket = /^(.*?)\s*[([]([^()[\]]+)[)\]]\s*$/u.exec(title);
    if (bracket?.[1]?.trim() && marker.test(bracket[2])) return result(bracket[1].trim(), bracket[2]);
    const structured = /^(.*?)\s*(?:[,;:]\s*|\s+[\-\u2013\u2014]\s+)(.+)$/u.exec(title);
    if (structured?.[1]?.trim() && marker.test(structured[2])) return result(structured[1].trim(), structured[2]);
    // Numeric shorthand and bare revision/access/format labels.
    const tail = /\s+((?:(?:edition|ed\.?|revision|rev\.?|version|release|printing)\s+\d+(?:\.\d+)*|\d+e|v(?:ersion)?\.?\s*\d+(?:\.\d+)*|(?:revised|updated|expanded|annotated)(?:\s*(?:and|&)\s*(?:revised|updated|expanded|annotated))*(?:\s+(?:edition|ed\.?|version))?|(?:abridged|unabridged|paperback|hardcover|hardback|softcover|ebook|e-book|digital|pdf|epub|mobi|cbz|cbr)))\s*$/iu.exec(title);
    if (tail) return result(title.slice(0, tail.index).trim(), tail[1]);
    // English ordinals are compositional: twenty-first, one hundred and first,
    // eleventh and hundredth use the same rule; numeric ordinals are unbounded.
    const ordinal = '(?:first|second|third|(?:four|fif|six|seven|eigh|nin|ten|eleven|twelf|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred|thousand|million|billion)th|(?:twent|thirt|fort|fift|sixt|sevent|eight|ninet)ieth)';
    const tens = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
    const compound = '(?:(?:one|two|three|four|five|six|seven|eight|nine) (?:hundred|thousand|million|billion)(?: and)? )?(?:'+tens+'[- ])?'+ordinal;
    const ordinalTail = new RegExp('\\s+('+compound+'|\\d+(?:st|nd|rd|th)?)$', 'iu');
    const ending = /\s+(?:(?:revised|updated|expanded|annotated|anniversary)\s+)*(?:edition|ed\.?|revision|version|printing)\s*$/iu.exec(title);
    if (ending) {
      const prefix = title.slice(0, ending.index).trim();
      const number = ordinalTail.exec(prefix);
      if (number) return result(prefix.slice(0, number.index).trim(), title.slice(number.index).trim());
    }
    return result(title);
  }
  function revisionWordingConflict(left, right, kind = 'book') {
    if (!['book', 'audiobook', 'software'].includes(kind)) return false;
    const a = revisionTitleParts(left, kind), b = revisionTitleParts(right, kind);
    const revision = /\b(?:edition|ed\.?|revision|rev\.?|revised|updated|expanded|annotated|abridged|unabridged|version|release|printing|reprint)\b|\b\d+e\b|\bv\d+(?:\.\d+)*\b/iu;
    const titles = [presentationTitle(left, kind), presentationTitle(right, kind)];
    // Pairwise fallback: an unfamiliar trailing descriptor can still warn
    // when it explicitly labels a revision of the complete shorter title.
    for (const [base, longer] of [titles, [...titles].reverse()]) {
      if (base.replace(/\s/gu, '').length >= (kind === 'software' ? 8 : 4)
        && longer.startsWith(base+' ') && revision.test(longer.slice(base.length+1))) return true;
    }
    return Boolean((revision.test(a.qualifier) || revision.test(b.qualifier))
      && presentationTitle(a.base, kind).replace(/\s/gu, '').length >= (kind === 'software' ? 8 : 4)
      && presentationTitle(a.base, kind) === presentationTitle(b.base, kind)
      && presentationTitle(a.qualifier, kind) !== presentationTitle(b.qualifier, kind));
  }
  // Review-only collection structure. Never used for full-title identity.
  function numberedCollectionRelation(left, right, kind = 'book') {
    if (!['book', 'audiobook'].includes(kind)) return null;
    const parts = value => {
      let title = String(value ?? '').normalize('NFKC').trim();
      const format = /\s+(?:[\[(]\s*)?(?:digital|digital edition|tp|tpb|hc|paperback|hardcover|trade paperback|pdf|epub|cbz|cbr)(?:\s*[\])])?\s*$/iu;
      while (format.test(title)) title = title.replace(format, '').trim();
      const match = /^(.*?)\b(?:vol(?:ume)?\.?|book)\s*(\d+(?:\.\d+)?)(?=$|\s|:)/iu.exec(title);
      if (!match) return { series: presentationTitle(title, kind), unit: '', subtitle: '', run: '' };
      const tail = title.slice(match[0].length).trim();
      // Do not reinterpret ranges, unlabeled prose, or multiple units.
      if (tail && !tail.startsWith(':')) return null;
      const run = /\((\d{4}(?:\s*[-\u2013\u2014]\s*\d{4})?)\)/u.exec(match[1]);
      let series = match[1].replace(/\(\d{4}(?:\s*[-\u2013\u2014]\s*\d{4})?\)/gu, '').replace(/[,;:\s]+$/u, '');
      series = series.replace(/\s+(?:deluxe|new|revised|updated|expanded|\d+(?:st|nd|rd|th)?)\s+edition$/iu, '');
      const text = tail.replace(/^:\s*/u, '');
      const editionOnly = /^(?:(?:new|deluxe|revised|updated|expanded|annotated|\d+(?:st|nd|rd|th)?)\s+)*(?:edition|ed\.?)$/iu.test(text);
      const subtitle = revisionTitleParts(editionOnly ? '' : text, kind);
      return { series: presentationTitle(series, kind), unit: unitKey(match[2]),
        subtitle: presentationTitle(subtitle.base, kind), run: run ? presentationTitle(run[1], 'unit') : '' };
    };
    const a = parts(left), b = parts(right);
    if (!a || !b || !(a.unit || b.unit)) return null;
    if (a.unit && b.unit && a.unit !== b.unit) return '';
    if (a.series !== b.series) return null;
    if (a.run && b.run && a.run !== b.run) return '';
    const generic = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'with', 'book', 'books', 'guide', 'complete', 'collection', 'introduction', 'manual']);
    const distinctive = new Set(a.series.split(' ').filter(word => /\p{L}/u.test(word) && word.length >= 3 && !generic.has(word)));
    if (distinctive.size < 2) return null;
    if (a.subtitle && b.subtitle && a.subtitle !== b.subtitle) return '';
    return 'Related distinctive series with compatible or unspecified volume; subtitle, run or edition identity needs review.';
  }
  function personKey(value) {
    let name = String(value ?? '').normalize('NFKC').toLowerCase().trim();
    name = name.replace(/\s*\((?:author|writer|artist|illustrator|editor|translator|pencill?er|inker|colorist|colourist|letterer)\)\s*$/u, '').trim();
    const comma = /^([^,]+),\s*([^,]+)$/u.exec(name);
    if (comma) name = comma[2] + ' ' + comma[1];
    return name.replace(/['\u2018\u2019]/gu, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  }
  function authorNameVariant(left, right) {
    const a = personKey(left), b = personKey(right);
    if (!a || !b) return false;
    const accent = name => name.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC');
    if (accent(a) === accent(b)) return true;
    const l = a.split(' '), r = b.split(' ');
    if (l.length < 2 || r.length < 2) return false;
    if ([...l].sort().join(' ') === [...r].sort().join(' ')) return true;
    if (l.at(-1) !== r.at(-1)) return false;
    const given = (x, y) => x === y || x.length === 1 && y.startsWith(x) || y.length === 1 && x.startsWith(y);
    if (!given(l[0], r[0])) return false;
    // An omitted middle name is missing information; two explicit incompatible
    // middle names are not silently equivalent. Initials remain review-only.
    const lm = l.slice(1, -1), rm = r.slice(1, -1);
    return !lm.length || !rm.length || lm.length === rm.length && lm.every((name, index) => given(name, rm[index]));
  }
  function authorRelation(left = [], right = []) {
    const a = (Array.isArray(left) ? left : [left]).map(personKey).filter(Boolean);
    const b = (Array.isArray(right) ? right : [right]).map(personKey).filter(Boolean);
    if (!a.length || !b.length) return 'missing';
    if (a.some(name => b.includes(name))) return 'same';
    if (a.some(name => b.some(other => authorNameVariant(name, other)))) return 'variant';
    return 'different';
  }
  function authorNames(authors, contributors = []) {
    const rows = Array.isArray(contributors) ? contributors : [];
    const writers = rows.filter(row => /^(?:author|writer|story|story writer)$/iu.test(String(row?.role ?? '').trim()))
      .map(row => row?.name).filter(name => typeof name === 'string' && name.trim());
    // Known writer roles take precedence over a mixed creator list. An artist
    // shared by two books must not conceal explicitly different writers.
    const values = writers.length ? writers : Array.isArray(authors) ? authors : [authors];
    return [...new Set(values.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
  }
  function ambiguousWorks(records, fields, barrier = () => false) {
    return records.some((left, index) => records.slice(index + 1).some(right => {
      if (barrier(left, right)) return true;
      const a = fields(left), b = fields(right);
      if (authorRelation(a.authors, b.authors) === 'different') return true;
      return ['run', 'unitType', 'unit', 'volume', 'issue'].some(field => a[field] && b[field]
        && (['unit', 'volume', 'issue'].includes(field) ? unitKey(a[field]) !== unitKey(b[field]) : personKey(a[field]) !== personKey(b[field])));
    }));
  }
  function unitKey(value) {
    const text = String(value ?? '').trim();
    const fraction = /^(\d+)\/(\d+)$/u.exec(text);
    if (fraction && Number(fraction[2])) return String(Number(fraction[1]) / Number(fraction[2]));
    return /^\d+(?:\.\d+)?$/u.test(text) ? String(Number(text)) : presentationTitle(text, 'unit');
  }
  global.LibraryMatchingPolicy = Object.freeze({ presentationTitle, ownershipTitleKeys, fullTitleMatches,
    relatedPresentationReason, relatedTitleKeys, revisionTitleParts, revisionWordingConflict, numberedCollectionRelation, personKey, authorRelation, authorNames, unitKey, ambiguousWorks });
}(globalThis));
// END SHARED MATCHING POLICY
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


  // Presentation equality is deliberately narrower than the discovery key:
  // Keep articles, general Roman numerals, preview labels and +/# symbols.
  // Roman numbers after an explicit volume/issue label are unit numbers.
  function presentationTitle(value, kind = 'book') { return global.LibraryMatchingPolicy.presentationTitle(value, kind); }

  function relationTitleParts(value, kind) {
    let title = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const revision = global.LibraryMatchingPolicy.revisionTitleParts(title, kind);
    if (revision.qualifier) title = revision.base;
    const edition = /\s*(?:[,;:\-\u2013\u2014]\s*)?((?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|expanded|annotated|new|deluxe)(?:\s+(?:revised|updated))?\s+(?:edition|ed\.?))\s*$/iu;
    let hasEdition = Boolean(revision.qualifier);
    if (kind === 'software') {
      const version = /^(.*?)\s*(?:[,;:\-\u2013\u2014]\s*)?(?:v(?:ersion)?\.?\s*\d+(?:\.\d+){0,3}|(?:19|20)\d{2})\s*$/iu.exec(title);
      return { primary: normalizeTitle(version?.[1]?.trim() || title), hasVersion: Boolean(revision.qualifier || version?.[1]?.trim()), subtitle: false, qualifier: false, hasEdition: false };
    }
    const stripEdition = () => {
      const found = edition.exec(title);
      if (found && found.index > 0) { title = title.slice(0, found.index).trim(); hasEdition = true; }
    };
    stripEdition();
    const qualifier = /^(.*?)\s*\(([^()]*)\)\s*$/u.exec(title);
    if (qualifier?.[1]?.trim()) {
      hasEdition ||= edition.test(' ' + qualifier[2]);
      title = qualifier[1].trim(); stripEdition();
    }
    const subtitle = /^(.*?)\s*:\s+(.+)$/u.exec(title);
    return { primary: kind === 'book' ? presentationTitle(subtitle?.[1]?.trim() || title, kind) : normalizeTitle(subtitle?.[1]?.trim() || title), subtitle: Boolean(subtitle),
      qualifier: Boolean(qualifier), hasEdition, hasVersion: false };
  }

  const CANDIDATE_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'with', 'by', 'vol', 'volume', 'edition', 'book', 'game', 'software']);
  function candidateTitleKeys(title, kind) {
    const words = normalizeTitle(title).split(' ').filter(word => word.length > 1 && !CANDIDATE_STOP_WORDS.has(word));
    const keys = [...words.map(word => 'word:' + word), ...global.LibraryMatchingPolicy.relatedTitleKeys(title, kind)];
    for (const word of words) if (word.length >= 7 && !/\p{N}/u.test(word)) {
      keys.push('start:' + word.slice(0, 3), 'end:' + word.slice(-3));
    }
    keys.push('primary:' + relationTitleParts(title, kind).primary);
    return [...new Set(keys)];
  }

  function closeTitleSpelling(left, right) {
    const a = Array.from(left); const b = Array.from(right);
    const limit = Math.min(a.length, b.length) >= 16 ? 2 : 1;
    if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > limit) return false;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (Math.min(...row) > limit) return false;
      previous = row;
    }
    return previous[b.length] <= limit;
  }

  // Candidate rules never prove ownership. Callers must still check media,
  // known authors, runs and numbered units before presenting these warnings.
  function possibleTitleRelation(left, right, kind = 'book') {
    const a = normalizeTitle(left); const b = normalizeTitle(right);
    if (!a || !b) return '';
    const numbered = global.LibraryMatchingPolicy.numberedCollectionRelation(left, right, kind);
    if (numbered !== null) return numbered;
    const presentation = global.LibraryMatchingPolicy.relatedPresentationReason(left, right, kind);
    if (presentation) return presentation;
    if (a === b) return 'Related title presentation; identity needs review.';
    if (global.LibraryMatchingPolicy.revisionWordingConflict(left, right, kind)) return 'Related complete base title with revision or version wording; identity needs review.';
    const access = value => value.replace(/\s+(?:preview|sample|excerpt|read now|demo|trial)$/iu, '').trim();
    if (access(a) === access(b)) return 'Related title, but preview/sample access does not establish the full product.';
    const numbers = value => (value.match(/\d+(?:\.\d+|\/\d+)?/gu) ?? []).join('|');
    const l = relationTitleParts(left, kind); const r = relationTitleParts(right, kind);
    if (l.primary && l.primary === r.primary) {
      if (kind === 'software' && (l.hasVersion || r.hasVersion) && l.primary.replace(/\s/gu, '').length >= 8) return 'Related software title with different version labels.';
      if (kind === 'book' || kind === 'audiobook') {
        if (l.hasEdition || r.hasEdition) return 'Related main title with different edition or subtitle wording.';
        // A bare title may have a longer store presentation, even if short.
        // Independently subtitled works are not inferred from a shared prefix.
        if (!(l.subtitle && r.subtitle) && (l.subtitle || r.subtitle || l.qualifier || r.qualifier)
          && l.primary.replace(/\s/gu, '').length >= 4) return 'One title is a shortened or qualified presentation of the other.';
        if (l.subtitle && r.subtitle) return '';
      }
    }
    if (kind === 'game') {
      const collection = value => {
        if (!/\b(?:collection|trilogy|complete pack|ultimate collection)\b/iu.test(value)) return '';
        return normalizeTitle(value).replace(/\b(?:the|complete|ultimate|collection|trilogy|pack)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
      };
      for (const [base, other] of [[collection(left), b], [collection(right), a]]) {
        if (base.length >= 4 && (other === base || other.startsWith(base + ' '))) return 'This game may be included in the named library collection; contents need review.';
      }
    }
    // Do not turn different numbered releases/units into typo warnings.
    if (numbers(a) !== numbers(b)) return '';
    if (closeTitleSpelling(a, b)) return 'The titles have a small spelling difference; review the library item.';
    const words = value => new Set(value.split(' ').filter(word => !CANDIDATE_STOP_WORDS.has(word)));
    const aw = words(a); const bw = words(b);
    const overlap = [...aw].filter(word => bw.has(word)).length;
    if (Math.min(aw.size, bw.size) >= 3 && overlap / new Set([...aw, ...bw]).size >= 0.8) return 'The titles have a close word match; identity needs review.';
    return '';
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
    const authors = names(global.LibraryMatchingPolicy.authorNames(raw.authors ?? raw.author, raw.contributors));
    const isbn = names(raw.isbn ?? raw.isbns ?? raw.isbn13 ?? raw.isbn10).map(validIsbn).filter(Boolean);
    if (authors.length) fields.authors = authors;
    if (isbn.length) fields.isbn = uniqueStrings(isbn);
    for (const key of ['asin', 'workId', 'editionId', 'edition', 'language', 'series', 'seriesId', 'run', 'runId', 'volume', 'issue', 'unitType']) {
      const entry = text(raw[key]);
      if (entry) fields[key] = key === 'language' ? entry.toLowerCase() : entry;
    }
    return fields;
  }

  function createTitleCatalog(items) {
    if(!Array.isArray(items))throw new Error('Expected a title list.');
    return {format:'humble-title-catalog',version:1,items:items.map(row=>{
      const item=normalizeLibraryImportItem(row);
      if(!item)throw new Error('Invalid catalog title.');
      return {title:item.title,mediaType:item.kind??'book',...bibliographicFields(row)};
    })};
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

  const BACKUP_VERSION = 9;
  const LIBRARY_STATE_DEFAULTS = {
    libraryItems: [], purchaseSummaries: [], customCollectionMappings: [],
    keyReminders: [], keyReminderScan: null, lastImport: null, mediaImportVersion: 1,
    historicalLibraryItems: [], historicalPurchaseSummaries: [], humbleProfileLabel: '', profileArchives: []
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

  const PROVENANCE_FIELDS = { providerItemId: 'string', title: 'string', sourceBundle: 'string', purchaseKey: 'string', purchasedAt: 'string?' };

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
      || value.format !== undefined && value.format !== 'humble-comic-library-backup'
      || !Number.isInteger(value.version) || value.version < 1 || value.version > BACKUP_VERSION) {
      throw new Error('Choose a supported Humble Comic Library backup, not a manual title list.');
    }
    if(value.version>=9&&(!Object.hasOwn(value,'profileLabel')||!Object.hasOwn(value,'profileArchives')))throw new Error('Backup is missing account/profile evidence.');
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
    const humbleProfileLabel=value.profileLabel??'';
    if(typeof humbleProfileLabel!=='string'||humbleProfileLabel.length>100)throw new Error('Invalid profile label.');
    const profileArchives=backupArray(value.profileArchives??[], 'profileArchives', (entry,path)=>{
      if(typeof entry.profileLabel!=='string'||!entry.profileLabel||entry.profileLabel.length>100||entry.backup?.profileArchives?.length)throw new Error('Invalid archived profile.');
      return {profileLabel:entry.profileLabel,backup:createLibraryBackup(restoreBackupState({...entry.backup,profileArchives:[]}))};
    });
    if(profileArchives.length>100)throw new Error('Too many archived profiles.');
    return { libraryItems, purchaseSummaries, keyReminders, keyReminderScan, lastImport, mediaImportVersion, customCollectionMappings, historicalLibraryItems, historicalPurchaseSummaries, humbleProfileLabel, profileArchives };
  }

  function createLibraryBackup(state, exportedAt = new Date().toISOString()) {
    const saved = { ...LIBRARY_STATE_DEFAULTS, ...state };
    return {
      version: BACKUP_VERSION, exportedAt, items: saved.libraryItems, purchases: saved.purchaseSummaries,
      collectionMappings: saved.customCollectionMappings, keyReminders: saved.keyReminders,
      keyReminderScan: saved.keyReminderScan, lastImport: saved.lastImport, mediaImportVersion: saved.mediaImportVersion,
      historicalItems: saved.historicalLibraryItems, historicalPurchases: saved.historicalPurchaseSummaries, profileLabel:saved.humbleProfileLabel, profileArchives:saved.profileArchives
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

  // Store identities stay separate from user-saved pairing configuration.
  const COMPANION_IDENTITIES=Object.freeze({
    hb:Object.freeze({name:'Humble Comic Library',chrome:'bjjpfofmcmiipeghcbhdfjedpldmkcii',firefox:'humble-comic-library@galactichamster.com'}),
    gl:Object.freeze({name:'Galactic Library',chrome:'pdknncacndkicpogbebdfanniibnnpic',firefox:'galactic-library@galactichamster.com'}),
    fan:Object.freeze({name:'Fanatical Library',chrome:'ieoobffekgbfjfoiheejkfihneooiadb',firefox:'fanatical-library@galactichamster.com'})
  });
  function companionBrowser(runtime=globalThis.chrome?.runtime){return runtime?.getURL?.('').startsWith('moz-extension:')||runtime?.getManifest?.().browser_specific_settings?.gecko?'firefox':'chrome';}
  function builtinGalacticId(runtime=globalThis.chrome?.runtime){return COMPANION_IDENTITIES.gl[companionBrowser(runtime)];}
  function resolveGalacticId(saved,runtime=globalThis.chrome?.runtime){return String(saved??'').trim()||builtinGalacticId(runtime);}
  function trustedGalacticSender(senderId,saved,runtime=globalThis.chrome?.runtime){return senderId===builtinGalacticId(runtime)||isExtensionId(saved)&&senderId===String(saved).trim();}
  function companionTargetProblem(id,runtime=globalThis.chrome?.runtime){
    const browser=companionBrowser(runtime);
    if(!isExtensionId(id))return 'Enter a valid Chrome extension ID or Firefox add-on ID.';
    if(browser==='chrome'&&!/^[a-p]{32}$/u.test(id))return 'This saved add-on ID is not a Chrome target. It is preserved; use a Chrome ID in Advanced settings.';
    // This is the sender manifest, not the receiver policy. Receiver restrictions
    // cannot be inferred locally; failed sends never prove the target is absent.
    return '';
  }

  async function testGalacticLink(send){
    const call=async message=>{
      let timer;
      try{
        const response=await Promise.race([send(message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connection timed out.')),30000);})]);
        if(response?.ok!==true)throw Error('Galactic Library rejected the request. Check Advanced pairing or update both extensions.');
        if(response.apiVersion!==1)throw Error('Incompatible Galactic Library API version. Update both extensions.');
        return response;
      }catch(error){if(/^(Connection timed out|Incompatible Galactic|Galactic Library rejected)/u.test(error.message))throw error;throw Error('Connection not verified. Install or enable Galactic Library, update both extensions, or check Advanced pairing. A receiver manifest may block custom IDs.');}
      finally{clearTimeout(timer);}
    };
    const ping=await call({type:'PING'}),status=await call({type:'GET_STATUS'});
    if(status.ready===false)throw Error('Galactic Library is not ready.');
    const mediaTypes=status.capabilities?.mediaTypes;
    if(mediaTypes!==undefined&&(!Array.isArray(mediaTypes)||!mediaTypes.every(type=>['game','book','audiobook','software'].includes(type))))throw Error('Incompatible Galactic Library capabilities.');
    return {appVersion:typeof ping.appVersion==='string'?ping.appVersion.slice(0,40):'',advertised:Array.isArray(mediaTypes),mediaTypes:mediaTypes??[]};
  }

  function isExtensionId(value) {
    const id = String(value ?? '').trim();
    const chromeId = /^[a-p]{32}$/u;
    // AMO uses email-style Gecko IDs. Require a non-empty local part and a
    // dotted DNS-like domain rather than accepting arbitrary text.
    const geckoId = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;
    return chromeId.test(id) || geckoId.test(id) || /^\{[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}$/iu.test(id);
  }


  function normalizeSummaryPreferences(value={},strict=false) {
    const positions=['bottom-right','bottom-left','top-right','top-left'];
    if(strict&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['minimized','position'].includes(key))||Object.hasOwn(value,'minimized')&&typeof value.minimized!=='boolean'||Object.hasOwn(value,'position')&&!positions.includes(value.position)))throw new Error('Invalid bundle summary preferences.');
    return {minimized:value?.minimized===true,position:positions.includes(value?.position)?value.position:'bottom-right'};
  }

  // Product tokens are not purchase IDs, key-delivery IDs or positional fallbacks.
  function nativeHumbleProductId(record) {
    const prefix=record.purchaseKey+':product:',id=record.providerItemId;
    return typeof id==='string'&&id.startsWith(prefix)&&id.length>prefix.length&&!id.slice(prefix.length).startsWith('position-')?id.slice(prefix.length):null;
  }
  const metadataTitle=value=>String(value??'').replace(/\s+/gu,' ').trim().toLowerCase();
  const metadataOrigins=item=>item.provenance?.length?item.provenance:[item];
  function productMetadataConflict(previous,incoming) {
    const a=bibliographicFields(previous),b=bibliographicFields(incoming);
    for(const field of ['asin','editionId','edition','language','volume','issue','runId','unitType'])if(a[field]&&b[field]&&metadataTitle(a[field])!==metadataTitle(b[field]))return true;
    return Boolean(a.isbn?.length&&b.isbn?.length&&!a.isbn.some(id=>b.isbn.includes(id)));
  }
  function missingProductIdScope(state) {
    const summary={examined:state.libraryItems.length,alreadyIdentified:0,missing:0,missingOrigins:0,purchaseKeys:[],historicalRows:state.historicalLibraryItems?.length??0};
    const purchases=new Set();
    for(const item of state.libraryItems){const origins=metadataOrigins(item),identified=origins.some(p=>nativeHumbleProductId(p)||p.entitlementId&&!p.entitlementId.startsWith('position-'));
      if(identified)summary.alreadyIdentified++;else summary.missing++;
    }
    for(const item of [...state.libraryItems,...(state.historicalLibraryItems??[])])for(const p of metadataOrigins(item))if(p.purchaseKey&&!nativeHumbleProductId(p)&&!(p.entitlementId&&!p.entitlementId.startsWith('position-'))){purchases.add(p.purchaseKey);summary.missingOrigins++;}
    summary.purchaseKeys=[...purchases].sort();return summary;
  }
  function enrichMissingProductIds(state,evidence) {
    const index=new Map();for(const item of evidence)for(const p of metadataOrigins(item)){if(!p.purchaseKey)continue;const key=JSON.stringify([p.purchaseKey,metadataTitle(p.title||item.title)]),rows=index.get(key)??[];rows.push({item,p});index.set(key,rows);}
    const stats={examined:0,alreadyIdentified:0,missing:0,recovered:0,noIdAvailable:0,ambiguous:0,conflicts:0,existingIdentityConflicts:0,historicalRecovered:0,metadataEnriched:0},details=[];
    function enrich(items,historical){return items.map((item,row)=>{let changed=false,resolvedSource;const origins=metadataOrigins(item).map((p,origin)=>{
      if(!historical)stats.examined++;
      if(nativeHumbleProductId(p)||p.entitlementId&&!p.entitlementId.startsWith('position-')){if(!historical){stats.alreadyIdentified++;const sources=index.get(JSON.stringify([p.purchaseKey,metadataTitle(p.title||item.title)]))??[],ids=sources.filter(v=>nativeHumbleProductId(v.p)).map(v=>v.p.providerItemId);if(nativeHumbleProductId(p)&&ids.length&&!ids.includes(p.providerItemId)){stats.existingIdentityConflicts++;details.push({row,origin,title:p.title||item.title,reason:'existingIdentityConflict',candidateIds:ids.map(id=>id.slice((p.purchaseKey+':product:').length))});}}return p;}
      if(!historical)stats.missing++;
      const all=index.get(JSON.stringify([p.purchaseKey,metadataTitle(p.title||item.title)]))??[],delivery=p.entitlement??'direct-download';
      const candidates=all.filter(v=>(v.item.kind??'book')===(item.kind??'book')&&(v.p.entitlement??'direct-download')===delivery),unique=new Map(candidates.filter(v=>nativeHumbleProductId(v.p)).map(v=>[v.p.providerItemId,v]));
      let reason='noIdAvailable';if(all.length&&!candidates.length||p.providerItemId&&unique.size&&!unique.has(p.providerItemId)||unique.size===1&&productMetadataConflict(item,[...unique.values()][0].item))reason='conflicts';else if(unique.size>1||unique.size===1&&candidates.some(v=>!nativeHumbleProductId(v.p)))reason='ambiguous';else if(unique.size===1&&!p.providerItemId){changed=true;resolvedSource=[...unique.values()][0].item;if(historical)stats.historicalRecovered++;else stats.recovered++;const attributed={...p,providerItemId:[...unique.keys()][0]};return item.provenance?.length?attributed:{...backupRecord(attributed,PROVENANCE_FIELDS,'Recovered purchase origin'),...entitlementFields(attributed)};}
      if(!historical){stats[reason]++;details.push({row,origin,title:p.title||item.title,reason,candidateIds:[...unique.keys()].map(id=>id.slice((p.purchaseKey+':product:').length))});}return p;
    });
      if(!changed)return item;const next={...item,provenance:origins};if(origins.length===1&&!item.providerItemId){next.providerItemId=origins[0].providerItemId;if(metadataTitle(item.title)===metadataTitle(origins[0].title||item.title)){let filled=false;for(const [key,value]of Object.entries(bibliographicFields(resolvedSource)))if(next[key]===undefined||next[key]===null||next[key]===''||Array.isArray(next[key])&&!next[key].length){next[key]=value;filled=true;}if(filled&&!historical)stats.metadataEnriched++;}}return next;
    });}
    return {libraryItems:enrich(state.libraryItems,false),historicalLibraryItems:enrich(state.historicalLibraryItems??[],true),stats,details};
  }
  function createSyncStore(area) {
    let tail=Promise.resolve();
    const controlKey='hclSyncControl',shareScopeKey='hclEntitlementShareScope';
    const scanFields=['libraryItems','purchaseSummaries','historicalLibraryItems','historicalPurchaseSummaries','lastImport','keyReminders','keyReminderScan','mediaImportVersion'];
    async function operate(operation,args){
      if(operation==='metadataTabClosed'){const control=(await area.get({[controlKey]:null}))[controlKey];if(control?.mode==='metadata'&&control.tabId===args[0])await area.set({[controlKey]:null});return true;}
      if(['metadataPreview','metadataBegin','metadataCommit','metadataCancel'].includes(operation)){
        const state=await area.get(LIBRARY_STATE_DEFAULTS),control=(await area.get({[controlKey]:null}))[controlKey];
        if(operation==='metadataPreview')return missingProductIdScope(state);
        if(operation==='metadataBegin'){const [options,tabId]=args;
          if(control&&!(control.mode==='metadata'&&control.tabId===tabId&&control.profileLabel===state.humbleProfileLabel))throw Error('Another Humble scan is active. Finish it first. If its tab was abandoned, use Import new purchases to establish a fresh scan before refreshing metadata.');
          if(options.confirmed!==true||!state.humbleProfileLabel||options.profileLabel!==state.humbleProfileLabel)throw Error('Confirm the signed-in account matches the active saved account. Metadata refresh cannot switch accounts.');
          const token=global.crypto.randomUUID();await area.set({[controlKey]:{token,tabId,profileLabel:state.humbleProfileLabel,mode:'metadata'}});return {token,scope:missingProductIdScope(state),backup:createLibraryBackup(state)};
        }
        const [token,evidence,tabId]=args;if(!control||control.mode!=='metadata'||control.token!==token||control.tabId!==tabId||control.profileLabel!==state.humbleProfileLabel)throw Error('Metadata refresh was superseded; original records were retained.');
        if(operation==='metadataCancel'){await area.set({[controlKey]:null});return true;}
        if(!Array.isArray(evidence)||evidence.length>50000)throw Error('Invalid metadata evidence.');
        const clean=restoreBackupState(createLibraryBackup({...LIBRARY_STATE_DEFAULTS,libraryItems:evidence})),result=enrichMissingProductIds(state,clean.libraryItems);
        restoreBackupState(createLibraryBackup({...state,libraryItems:result.libraryItems,historicalLibraryItems:result.historicalLibraryItems}));
        const sharing=(await area.get({[shareScopeKey]:null}))[shareScopeKey];
        await area.set({...(result.stats.recovered||result.stats.historicalRecovered?{libraryItems:result.libraryItems,historicalLibraryItems:result.historicalLibraryItems,[shareScopeKey]:sharing?{...sharing,revisionRef:global.crypto.randomUUID()}:null}:{}),[controlKey]:null});return {stats:result.stats,details:result.details};
      }
      if(operation==='syncAccounts'){
      const state=await area.get(LIBRARY_STATE_DEFAULTS),rows=await globalThis.GalacticPurchaseAdapters.accounts('hb',state),saved=(await area.get({galacticPurchaseAccountIds:{}})).galacticPurchaseAccountIds;
      const result=globalThis.GalacticPurchaseSync.registry(rows,saved);if(Object.keys(result.patch).length)await area.set(result.patch);return result.accounts;
    }
    if(['handoffAccounts','handoffSnapshot','handoffImport','handoffInventory','handoffPreview'].includes(operation)){
        const A=globalThis.GalacticPurchaseAdapters,S=globalThis.GalacticPurchaseSnapshot,state=await area.get(LIBRARY_STATE_DEFAULTS);
        if(operation==='handoffAccounts')return A.accounts('hb',state);
        if(operation==='handoffSnapshot')return A.snapshot('hb',state,args[0]);
        if(operation==='handoffInventory')return A.hbInventory(state,args[0]);
        const [raw,target]=args,data=S.validate(raw);if(data.provider!=='humble')throw Error('Wrong purchase provider.');
        if(operation!=='handoffPreview'&&(await area.get({[controlKey]:null}))[controlKey])throw Error('Wait for the Humble scan to finish before importing saved purchases.');
        let scope;
        if(target?.newLabel){const label=String(target.newLabel).trim();if(!label||label.length>100||A.hbScopes(state).some(value=>value.label===label)||target.expectedActiveLabel!==state.humbleProfileLabel)throw Error('Invalid or stale new account choice.');scope={label,items:[],state:{...LIBRARY_STATE_DEFAULTS,humbleProfileLabel:label},fresh:true};}
        else scope=await A.selected('hb',state,target?.accountRef);
      if(operation==='handoffImport'&&target?.autoSync){const ids=(await area.get({galacticPurchaseAccountIds:{}})).galacticPurchaseAccountIds;await globalThis.GalacticPurchaseSync.assertCommit(area,data.provider,target,ids[scope.label]);}
        const result=A.hbMerge(scope.items,data.records,Boolean(target?.autoSync));
        if(operation==='handoffPreview'){
          const hi=scope.fresh?await A.inventory({role:'hb',accountRef:'new-account-preview',accountLabel:scope.label,currentCount:0,historicalCount:0,observations:[]}):await A.hbInventory(state,target.accountRef),gi=await A.inventory({role:'gl',accountRef:data.accountRef,accountLabel:data.accountLabel,currentCount:data.records.length,historicalCount:0,observations:data.records.map((r,index)=>({rowRef:'current:'+index,status:'current',title:r.title,mediaType:r.mediaType,purchaseId:r.metadata.purchaseId,providerItemId:r.providerItemId,entitlement:r.metadata.entitlement,bundle:r.metadata.sourceBundle,purchasedAt:r.purchasedAt}))}),comparison=hi?A.reconcileInventories(hi,gi):null;
          return {readOnly:true,sourceRecords:data.records.length,destinationRecords:scope.items.length,...result.stats,...A.previewTitles(scope.items,result.items.slice(scope.items.length)),updateBreakdownKnown:false,enrichment:result.stats.updated,legacyMatchable:comparison?.counts.historicalPurchaseMatches??0,ambiguous:comparison?.counts.ambiguous??result.stats.skipped,conflicts:comparison?.counts.conflicts??0,limitations:[...data.limitations,'Conflicts are diagnostic; preview reports the existing merge rules, which can retain distinct observations rather than correcting their media.']};
        }
        const purchaseCounts=new Map();for(const row of data.records)purchaseCounts.set(row.metadata.purchaseId,(purchaseCounts.get(row.metadata.purchaseId)??0)+1);const purchases=new Map((scope.state.purchaseSummaries??[]).map(p=>[p.purchaseKey,p]));for(const row of data.records)if(!purchases.has(row.metadata.purchaseId))purchases.set(row.metadata.purchaseId,{purchaseKey:row.metadata.purchaseId,sourceBundle:row.metadata.sourceBundle??'',purchasedAt:row.purchasedAt,itemCount:purchaseCounts.get(row.metadata.purchaseId)});
        const next={...scope.state,libraryItems:result.items,purchaseSummaries:[...purchases.values()],profileArchives:[]};
        const clean=restoreBackupState(createLibraryBackup(next));
        if(!result.stats.added&&!result.stats.updated&&!scope.fresh&&clean.purchaseSummaries.length===(scope.state.purchaseSummaries??[]).length)return result.stats;
        if(scope.label===state.humbleProfileLabel||!state.humbleProfileLabel&&!state.libraryItems.length)await area.set({libraryItems:clean.libraryItems,purchaseSummaries:clean.purchaseSummaries,humbleProfileLabel:scope.label,[shareScopeKey]:null});
        else {const archives=state.profileArchives.filter(p=>p.profileLabel!==scope.label);archives.push({profileLabel:scope.label,backup:createLibraryBackup({...next,profileArchives:[]})});if(archives.length>100)throw Error('Too many saved accounts.');await area.set({profileArchives:archives,[shareScopeKey]:null});}
        return result.stats;
      }
      if(operation==='profiles'){
        const state=await area.get(LIBRARY_STATE_DEFAULTS),unique=new Map(state.profileArchives.map(entry=>[entry.profileLabel,entry]));
        if(state.humbleProfileLabel)unique.delete(state.humbleProfileLabel);
        return {activeLabel:state.humbleProfileLabel,profiles:[...(state.humbleProfileLabel?[{label:state.humbleProfileLabel,active:true,itemCount:state.libraryItems.length}]:[]),...[...unique.values()].map(entry=>({label:entry.profileLabel,active:false,itemCount:entry.backup.items.length}))]};
      }
      if(operation==='selectProfile'||operation==='renameProfile'){
        const [options]=args,state=await area.get(LIBRARY_STATE_DEFAULTS),label=String(options.profileLabel??'').trim();
        if(options.confirmed!==true)throw new Error('Confirm the selected account before continuing.');
        if(options.expectedActiveLabel!==state.humbleProfileLabel)throw new Error('The active account changed. Review the saved accounts and try again.');
        const selected=label===state.humbleProfileLabel&&label?null:[...state.profileArchives].reverse().find(entry=>entry.profileLabel===label);
        if(!label||label!==state.humbleProfileLabel&&!selected)throw new Error('This saved account is unavailable. Refresh the account list.');
        if(operation==='renameProfile'){
          const next=String(options.newLabel??'').trim();
          if(!next||next.length>100)throw new Error('Enter an account nickname of 1 to 100 characters.');
          if(next===label)return true;
          if(next===state.humbleProfileLabel||state.profileArchives.some(entry=>entry.profileLabel===next))throw new Error('That account nickname is already in use.');
          const archives=state.profileArchives.map(entry=>entry.profileLabel===label?{profileLabel:next,backup:{...entry.backup,profileLabel:next}}:entry);
          await area.set({...await globalThis.GalacticPurchaseSync?.renamePatch(area,label,next),profileArchives:archives,...(label===state.humbleProfileLabel?{humbleProfileLabel:next}:{}),hclPurchaseFocus:null,[controlKey]:null,[shareScopeKey]:null});return true;
        }
        if(label===state.humbleProfileLabel)return true;
        if(!state.humbleProfileLabel&&state.libraryItems.length)throw new Error('Confirm a nickname for the current library through the importer before switching saved accounts.');
        const snapshot=restoreBackupState({...selected.backup,profileArchives:[]});
        if(snapshot.humbleProfileLabel&&snapshot.humbleProfileLabel!==label)throw new Error('Saved account identity is inconsistent. Restore a valid backup first.');
        const archives=state.profileArchives.filter(entry=>entry.profileLabel!==label&&entry.profileLabel!==state.humbleProfileLabel);
        if(state.humbleProfileLabel)archives.push({profileLabel:state.humbleProfileLabel,backup:createLibraryBackup({...state,profileArchives:[]})});
        if(archives.length>100)throw new Error('Too many saved accounts. Export a backup first.');
        await area.set({...snapshot,humbleProfileLabel:label,profileArchives:archives,hclPurchaseFocus:null,[controlKey]:null,[shareScopeKey]:null});return true;
      }
      if(operation==='begin'){
        const [options,tabId]=args;const profileLabel=String(options.profileLabel??'').trim();
        if(!options.confirmed||!profileLabel||profileLabel.length>100)throw new Error('Enter an account nickname and confirm the signed-in Humble account.');
        const state=await area.get(LIBRARY_STATE_DEFAULTS);const changing=Boolean(state.humbleProfileLabel)&&state.humbleProfileLabel!==profileLabel;
        if(changing&&state.profileArchives.some(entry=>entry.profileLabel===profileLabel))throw new Error('This account is already saved. Use saved account before importing.');
        if(changing&&(!options.fullRescan||!options.switchProfile))throw new Error('Choose Rescan all purchases and explicitly select Save a new account.');
        const forceFull=changing||!state.humbleProfileLabel;const token=global.crypto.randomUUID();
        await area.set({[controlKey]:{token,tabId,profileLabel,changing,forceFull,fullRescan:options.fullRescan===true}});
        const baseline=changing?{...LIBRARY_STATE_DEFAULTS,libraryItems:state.libraryItems.filter(item=>item.source!=='humble'),customCollectionMappings:state.customCollectionMappings}:state;
        return {token,forceFull,state:baseline};
      }
      if(operation==='commit'){
        const [token,updates,tabId]=args;const stored=await area.get({[controlKey]:null});const control=stored[controlKey];
        if(!control||control.token!==token||control.tabId!==tabId)throw new Error('Scan superseded by another scan, clear, or restore. Start a fresh scan.');
        const current=await area.get(LIBRARY_STATE_DEFAULTS);
        if((control.changing||control.forceFull)&&updates.lastImport?.reconciled!==true)throw new Error('This profile requires a complete successful rescan; the prior library was retained.');
        if(control.fullRescan&&updates.lastImport?.reconciled!==true){
          const failed=updates.lastImport?.failedPurchaseKeys;
          const identities=items=>new Set(items.flatMap(item=>{const origins=item.provenance?.length?item.provenance:[item];return origins.map(origin=>JSON.stringify([catalogItemKey(item),origin.purchaseKey??'',origin.entitlementId??'']));}));
          const incoming=identities(Array.isArray(updates.libraryItems)?updates.libraryItems:[]);
          const purchases=new Set((updates.purchaseSummaries??[]).map(item=>item.purchaseKey));
          const history=identities(updates.historicalLibraryItems??current.historicalLibraryItems);
          const historicalPurchases=new Set((updates.historicalPurchaseSummaries??current.historicalPurchaseSummaries).map(item=>item.purchaseKey));
          if(!Array.isArray(failed)||!failed.length||[...identities(current.libraryItems)].some(ref=>!incoming.has(ref))||current.purchaseSummaries.some(item=>!purchases.has(item.purchaseKey))||[...identities(current.historicalLibraryItems)].some(ref=>!history.has(ref))||current.historicalPurchaseSummaries.some(item=>!historicalPurchases.has(item.purchaseKey)))throw new Error('Incomplete full scan cannot remove existing purchase evidence; prior library retained.');
        }
        const clean=Object.fromEntries(scanFields.filter(key=>Object.hasOwn(updates,key)).map(key=>[key,updates[key]]));
        if(control.changing){
          const archived={profileLabel:current.humbleProfileLabel,backup:createLibraryBackup({...current,profileArchives:[]})};
          clean.profileArchives=[...current.profileArchives.filter(entry=>entry.profileLabel!==archived.profileLabel),archived];
          if(clean.profileArchives.length>100)throw new Error('Too many archived profiles; export a backup first.');
        }
        clean.humbleProfileLabel=control.profileLabel;
        const checked=restoreBackupState(createLibraryBackup({...LIBRARY_STATE_DEFAULTS,...clean,profileArchives:[]}));for(const field of scanFields)if(Object.hasOwn(clean,field))clean[field]=checked[field];
        const sharing=await area.get({[shareScopeKey]:null});
        await area.set({...(!current.humbleProfileLabel?await globalThis.GalacticPurchaseSync?.renamePatch(area,'',control.profileLabel):{}),...clean,[controlKey]:null,[shareScopeKey]:control.changing?null:sharing[shareScopeKey]?{...sharing[shareScopeKey],revisionRef:global.crypto.randomUUID()}:null});return true;
      }
      if(operation==='replace'){
        const replacement=restoreBackupState(createLibraryBackup(args[0]));
        await area.set({galacticPurchaseAccountIds:{},galacticPurchaseSync:{},...replacement,hclPurchaseFocus:null,[controlKey]:null,[shareScopeKey]:null});return true;
      }
      if(operation==='shareSnapshot'){
        const [profileLabel]=args;const state=await area.get(LIBRARY_STATE_DEFAULTS);if(!profileLabel||state.humbleProfileLabel!==profileLabel)throw new Error('The active Humble profile changed. Refresh before sharing.');
        const stored=await area.get({[shareScopeKey]:null});let scope=stored[shareScopeKey];
        if(!scope||scope.profileLabel!==profileLabel){scope={profileLabel,salt:global.crypto.randomUUID(),revisionRef:global.crypto.randomUUID()};await area.set({[shareScopeKey]:scope});}
        return {state,scope};
      }
      if(operation==='verifyShareSnapshot'){
        const [scope,targetId]=args,stored=await area.get({[shareScopeKey]:null,galacticLibraryExtensionId:''});const active=stored[shareScopeKey];
        if(!active||active.salt!==scope.salt||active.revisionRef!==scope.revisionRef||active.profileLabel!==scope.profileLabel||resolveGalacticId(stored.galacticLibraryExtensionId)!==targetId)throw new Error('Library or GL link changed while sharing. Refresh and send again.');return true;
      }
      if(operation==='patch'){
        const updates=args[0];const allowed=['customCollectionMappings','showDiagnostics','openDirectPurchaseLinks','galacticLibraryExtensionId','catalogueFilters','showNewItemsOnly','hclPurchaseFocus','bundleSummaryPreferences','galacticHamsterAppearance'];
        if(!updates||Object.keys(updates).some(key=>!allowed.includes(key)))throw new Error('Unsupported state patch.');
        if(Object.hasOwn(updates,'galacticHamsterAppearance'))globalThis.GalacticHamsterTheme.validatePreferences(updates.galacticHamsterAppearance);
        if(Object.hasOwn(updates,'bundleSummaryPreferences')){normalizeSummaryPreferences(updates.bundleSummaryPreferences,true);const current=await area.get({bundleSummaryPreferences:{}});updates.bundleSummaryPreferences=normalizeSummaryPreferences({...normalizeSummaryPreferences(current.bundleSummaryPreferences),...updates.bundleSummaryPreferences},true);}
        await area.set(updates);return true;
      }
      if(operation==='wishlist'){
        const [action,items]=args;const stored=await area.get({wishlistItems:[]});const current=normalizeWishlist(stored.wishlistItems);
        const next=action==='remove'?current.filter(item=>catalogItemKey(item)!==items):action==='replace'?normalizeWishlist(items):normalizeWishlist([...current,...items]);
        await area.set({wishlistItems:next});return next;
      }
      if(operation==='remove'){
        const keys=args[0];if(!Array.isArray(keys))throw new Error('Invalid removal.');
        const clear=keys.includes('libraryItems');
        if(!clear&&keys.some(key=>!['hclPurchaseFocus','galacticLibraryExtensionId'].includes(key)))throw new Error('Unsupported removal.');
        await area.remove(clear?['galacticPurchaseAccountIds','galacticPurchaseSync',...Object.keys(LIBRARY_STATE_DEFAULTS),'hclPurchaseFocus',controlKey,shareScopeKey]:keys);return true;
      }
      throw new Error('Unsupported library operation.');
    }
    return {execute(operation,args=[]){const copied=JSON.parse(JSON.stringify(args));const task=tail.then(()=>operate(operation,copied));tail=task.catch(()=>{});return task;}};
  }
  async function storageRequest(operation,...args){
    const response=await chrome.runtime.sendMessage({type:'HCL_STORE',operation,args});
    if(!response?.ok)throw new Error(response?.error??'Library storage is unavailable. Reload the extension and page.');
    return response.result;
  }
  const storageSet=updates=>storageRequest(Object.hasOwn(updates,'libraryItems')?'replace':'patch',updates);
  const storageRemove=keys=>storageRequest('remove',Array.isArray(keys)?keys:[keys]);

  global.HumbleComicLibrary = {
    normalizeSummaryPreferences, createSyncStore, storageRequest, storageSet, storageRemove, nativeHumbleProductId, missingProductIdScope, enrichMissingProductIds,
    COMPANION_IDENTITIES, companionBrowser, builtinGalacticId, resolveGalacticId, trustedGalacticSender, companionTargetProblem, testGalacticLink, normalizeTitle, presentationTitle, possibleTitleRelation, candidateTitleKeys, titleKey, normalizeLibraryImportItem, uniqueStrings, isExtensionId, catalogItemKey, normalizeWishlist, entitlementFields,
    createTitleCatalog, LIBRARY_STATE_DEFAULTS, createLibraryBackup, restoreBackupState, manualTitleImportState,
    text, names, validIsbn, bibliographicFields
  };
}(globalThis));

/* Identical account picker in both companions; all changes use the serialized writer. */
(function(global){
  function mount(host,{request,keys,onActiveChange=()=>{}}){
    if(!host?.ownerDocument)return {refresh:async()=>{}};
    const details=document.createElement('details');details.className='account-manager';
    details.innerHTML='<summary>Saved accounts</summary><p>Use a saved account to restore its library and scan history. Sign in to that website account separately; this selector does not change your login. Only the active account is used for ownership checks.</p><label>Saved account <select data-account-list></select></label><label><input type="checkbox" data-account-confirm> The website is signed in to the selected account</label><div class="account-actions"><button type="button" data-account-use>Use saved account</button></div><label>New nickname for selected account <input data-account-name maxlength="100" placeholder="e.g. personal"></label><div class="account-actions"><button type="button" data-account-rename>Rename account</button></div><p>Renaming changes only this local name. For a new website account, enter a new nickname in the purchase importer and use Rescan all purchases with Save a new account selected.</p><p data-account-status role="status" aria-live="polite"></p>';
    host.append(details);
    const list=details.querySelector('[data-account-list]'),confirmed=details.querySelector('[data-account-confirm]'),name=details.querySelector('[data-account-name]'),use=details.querySelector('[data-account-use]'),rename=details.querySelector('[data-account-rename]'),status=details.querySelector('[data-account-status]');
    let data={activeLabel:'',profiles:[]},active,revision=0,busy=false;
    const controls=()=>{list.disabled=confirmed.disabled=name.disabled=busy||!data.profiles.length;use.disabled=busy||!list.value||list.value===data.activeLabel;rename.disabled=busy||!list.value;};
    async function refresh(){
      const generation=++revision;
      try{
        const next=await request('profiles');if(generation!==revision)return;
        const previous=active,selected=list.value;data=next;active=next.activeLabel;
        list.replaceChildren(...next.profiles.map(profile=>{const option=document.createElement('option');option.value=profile.label;option.textContent=profile.label+(profile.active?' (active)':'')+' - '+profile.itemCount+' items';return option;}));
        list.value=previous===active&&next.profiles.some(profile=>profile.label===selected)?selected:active||next.profiles[0]?.label||'';
        if(previous!==active||name.value===''){name.value=list.value;confirmed.checked=false;}
        details.querySelector('summary').textContent='Saved accounts ('+next.profiles.length+')'+(active?' - active: '+active:' - not yet named');
        controls();if(previous!==active)onActiveChange(active,previous);
      }catch(error){if(generation===revision)status.textContent='Could not load saved accounts: '+error.message;}
    }
    list.addEventListener('change',()=>{confirmed.checked=false;name.value=list.value;controls();});
    use.addEventListener('click',async()=>{
      if(!confirmed.checked){status.textContent='Confirm the website is signed in to the selected account first.';return;}
      const label=list.value;busy=true;controls();
      try{await request('selectProfile',{profileLabel:label,expectedActiveLabel:data.activeLabel,confirmed:true});await refresh();confirmed.checked=false;status.textContent='Using '+label+'. Its saved library is active; Import new purchases checks for changes without a mandatory full rescan.';}
      catch(error){status.textContent=error.message;await refresh();}finally{busy=false;controls();}
    });
    rename.addEventListener('click',async()=>{
      const label=list.value,next=name.value.trim();busy=true;controls();
      try{await request('renameProfile',{profileLabel:label,newLabel:next,expectedActiveLabel:data.activeLabel,confirmed:true});await refresh();list.value=next;name.value=next;confirmed.checked=false;status.textContent='Renamed '+label+' to '+next+'. Purchases and scan history were kept; no scan was started.';}
      catch(error){status.textContent=error.message;await refresh();}finally{busy=false;controls();}
    });
    chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&keys.some(key=>changes[key]))refresh();});
    refresh();return {refresh};
  }
  global.LibraryAccountProfiles={mount};
}(globalThis));

// BEGIN SHARED NATURAL TITLE SORT
// Presentation only: never use these keys for product or issue identity.
(function(global){
  'use strict';
  const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const ordinal=['zeroth','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth'];
  const tens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const tensOrdinal=['twentieth','thirtieth','fortieth','fiftieth','sixtieth','seventieth','eightieth','ninetieth'];
  const atom=word=>{const a=small.indexOf(word),b=ordinal.indexOf(word),c=tens.indexOf(word),d=tensOrdinal.indexOf(word);return a>=0?a:b>=0?b:c>=0?(c+2)*10:d>=0?(d+2)*10:null;};
  function written(words){
    if(!words.length)return null;
    if(words.length===1)return atom(words[0]);
    if(words.length===2&&tens.includes(words[0])){const last=atom(words[1]);return last>0&&last<10?atom(words[0])+last:null;}
    if(words.length>=2&&small.indexOf(words[0])>0&&small.indexOf(words[0])<10&&['hundred','hundredth'].includes(words[1])){
      if(words[1]==='hundredth'&&words.length>2)return null;
      let rest=words.slice(2);if(rest[0]==='and')rest=rest.slice(1);
      const tail=rest.length?written(rest):0;return tail!==null&&tail<100?atom(words[0])*100+tail:null;
    }
    return null;
  }
  function key(title){
    return String(title??'').replace(/\b(book|volume|vol\.?|part)\s+(\d+(?:st|nd|rd|th)?\b|[a-z]+(?:[-\s]+[a-z]+){0,5})/giu,(raw,marker,phrase)=>{
      let value,used;
      if(/^\d/u.test(phrase)){value=Number.parseInt(phrase,10);used=phrase.length;}
      else{
        const tokens=[...phrase.toLowerCase().matchAll(/[a-z]+/gu)];
        for(let n=tokens.length;n>0;n--){value=written(tokens.slice(0,n).map(t=>t[0]));if(value!==null){used=tokens[n-1].index+tokens[n-1][0].length;break;}}
      }
      if(value===null||value===undefined)return raw;
      const label=/^vol/iu.test(marker)?'Volume':marker;
      return label+' '+value+phrase.slice(used);
    });
  }
  const compare=(left,right)=>collator.compare(key(left),key(right))||String(left??'').localeCompare(String(right??''));
  global.LibraryTitleSort=Object.freeze({compare,key});
})(globalThis);
// END SHARED NATURAL TITLE SORT
