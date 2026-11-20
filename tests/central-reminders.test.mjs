import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Galactic Library's reminder list in Humble Library, read-only and validated as in Fanatical Library (WP-15).
function load() {
  const context = vm.createContext({console, Date, Intl, URL, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, structuredClone});
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(new URL('../shared.js', import.meta.url), 'utf8'), context, {filename: 'shared.js'});
  return context.HumbleComicLibrary;
}
const row = (n, extra = {}) => ({reminderRef: 'r' + n, itemRef: 'i' + n, title: 'Synthetic ' + n, provider: 'humble', mediaType: 'game', kind: 'activation', dueAt: null, severity: 'information', ...extra});

test('Humble Library pages through Galactic Library reminders for Humble by default', async () => {
  const H = load(), sent = [];
  const send = async message => {
    sent.push(JSON.parse(JSON.stringify(message)));
    if (message.type === 'GET_STATUS') return {ok: true, apiVersion: 1, ready: true, capabilities: {entitlementReminders: true}};
    return {ok: true, apiVersion: 1, total: 3, nextOffset: message.offset + 2 < 3 ? message.offset + 2 : null, reminders: [row(1), row(2, {kind: 'key-expiry', dueAt: '2027-01-31'})].slice(0, Math.min(2, 3 - message.offset))};
  };
  const page = JSON.parse(JSON.stringify(await H.loadCentralReminders(send, {offset: 0, limit: 2})));
  assert.deepEqual(sent.at(-1), {type: 'GET_REMINDERS', apiVersion: 1, offset: 0, limit: 2, provider: 'humble'});
  assert.equal(page.total, 3);assert.equal(page.nextOffset, 2);assert.equal(page.reminders.length, 2);
  await H.loadCentralReminders(send, {provider: '', offset: 2, limit: 2});
  assert.equal(sent.at(-1).provider, undefined, 'All providers sends no provider filter');
});

test('invalid pages, older Galactic Library versions and other providers are rejected', async () => {
  const H = load();
  const status = caps => async message => message.type === 'GET_STATUS' ? {ok: true, apiVersion: 1, ready: true, capabilities: caps} : {ok: true, apiVersion: 1, total: 1, nextOffset: null, reminders: [row(1, {provider: 'steam'})]};
  await assert.rejects(H.loadCentralReminders(status({})), /does not advertise entitlement reminders/);
  await assert.rejects(H.loadCentralReminders(status({entitlementReminders: true})), /invalid reminder page/);
  await assert.rejects(H.loadCentralReminders(status({entitlementReminders: true}), {provider: 'not-a-store'}), /Invalid reminder page or provider/);
  await assert.rejects(H.loadCentralReminders(async () => ({ok: false})), /rejected the request/);
});
