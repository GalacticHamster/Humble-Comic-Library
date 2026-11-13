// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
(async function initPopup() {
  const { libraryItems = [], libraryEntitlements = null, humbleAccountId = null } = await chrome.storage.local.get({ libraryItems: [], libraryEntitlements: null, humbleAccountId: null });
  // A count only; the Options page validates these records before showing them.
  const scope = humbleAccountId && Array.isArray(libraryEntitlements?.scopes) ? libraryEntitlements.scopes.find(s => s?.localAccountId === humbleAccountId) : null;
  const synced = Array.isArray(scope?.observations) ? scope.observations.filter(r => r?.purchaseStatus === 'purchased').length : 0;
  const parts = [];
  if (libraryItems.length) parts.push(`${libraryItems.length.toLocaleString()} item${libraryItems.length === 1 ? '' : 's'} in your local library.`);
  if (synced) parts.push(`${synced.toLocaleString()} purchase${synced === 1 ? '' : 's'} synced from your Humble Library.`);
  document.querySelector('#status').textContent = parts.length ? parts.join(' ') : 'Nothing saved yet. Open your Humble Library to sync your purchases.';
  document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
