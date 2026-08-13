/* Global helpers shared by the options page and Humble page overlay. */
(function attachHumbleLibraryHelpers(global) {
  'use strict';

  const FORMAT_WORDS = /\b(?:pdf|cbz|cbr|epub|mobi|kindle|digital\s+edition)\b/giu;
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

  function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
  }

  global.HumbleComicLibrary = { normalizeTitle, titleKey, uniqueStrings };
}(globalThis));
