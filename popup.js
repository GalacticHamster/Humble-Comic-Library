// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
(async function initPopup() {
  const { libraryItems = [] } = await chrome.storage.local.get({ libraryItems: [] });
  document.querySelector('#status').textContent = libraryItems.length
    ? `${libraryItems.length} item${libraryItems.length === 1 ? '' : 's'} in your local library.`
    : 'No titles imported yet.';
  document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
