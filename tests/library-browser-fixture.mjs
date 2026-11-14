import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Loads the presentation model with the native module enabled or disabled.
export function load({enabled = true} = {}) {
  const context = vm.createContext({console, Intl, Date, URL, TextEncoder, crypto: webcrypto});
  context.globalThis = context;
  const source = fs.readFileSync(new URL('../library-entitlements.js', import.meta.url), 'utf8');
  vm.runInContext(enabled ? source : source.replace('const ENABLED = true;', 'const ENABLED = false;'), context);
  vm.runInContext(fs.readFileSync(new URL('../library-browser.js', import.meta.url), 'utf8'), context);
  return {E: context.HumbleLibraryEntitlements, B: context.HumbleLibraryBrowser};
}
export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const scopeRef = {principalId: 'principal-A', userId: 'hub-A'};
export function nativeObservation(E, {id, parent, title, namespace = 'download_drm_free', parentType = 'bundle', parentTitle, gifted = false, revoked = null}) {
  return E.observation({scope: scopeRef, nativeId: uuid(id), namespace, title, parentId: uuid(parent), ...(parentTitle ? {parentTitle} : {}), source: 'authenticated-humble-library', observedAt: '2026-11-13T03:16:00.000Z',
    eligibility: {expired: false, preOrdered: false, outOfStock: false, redeemable: true, directRedeem: false, parentPreOrder: false, revoked, temporaryAccess: null,
      giftStatus: gifted ? 'gifted' : 'unassigned', parentType, integration: 'none', redemptionGroups: 'none', unavailableBefore: {state: 'none', value: null}, unavailableAfter: {state: 'none', value: null}, redeemedAt: {state: 'none', value: null}}});
}
export const entitlements = (observations, localAccountId = ACCOUNT, sync = null) => ({version: 1, scopes: [{...scopeRef, localAccountId, profileLabel: 'Main', observations, lastScan: null, sync}]});
