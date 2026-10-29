// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared.js';
import '../purchase-snapshot.js';
import '../purchase-adapters.js';
const A=globalThis.GalacticPurchaseAdapters;
test('GL entitlement references resolve to the existing HB purchase key without replacing IDs or origins',()=>{
 const id='order-one:key:game-one:0',origin={title:'Synthetic game',purchaseKey:'order-one',providerItemId:id,entitlement:'third-party-key',entitlementId:'game-one:0'};
 const existing={...origin,kind:'game',source:'humble',provenance:[origin]},incoming={providerItemId:'order-one:entitlement:game-one:0',title:'Synthetic game',mediaType:'game',metadata:{purchaseId:'order-one',entitlement:'third-party-key'},purchasedAt:null,origins:[]};
 for(let n=0,items=[existing];n<3;n++){
  const result=A.hbMerge(items,[incoming],true);assert.equal(result.stats.added,0);items=result.items;
  assert.equal(items.length,1);assert.equal(items[0].providerItemId,id);assert.equal(items[0].provenance.length,1);assert.equal(items[0].provenance[0].providerItemId,id);
 }
 const conflict=A.hbMerge([existing],[{...incoming,mediaType:'software'}],true);assert.equal(conflict.stats.skipped,1);assert.deepEqual(conflict.items,[existing]);
});
test('Humble reference equivalence never uses names, positional fallbacks or a different purchase/index',()=>{
 assert.equal(A.humbleEntitlementAlias('order-one:key:game-one:0','order-one'),'order-one:entitlement:game-one:0');
 assert.equal(A.humbleEntitlementAlias('order-one:key:game-one:0','other-order'),null);
 assert.equal(A.humbleEntitlementAlias('order-one:key:position-0:0','order-one'),null);
 assert.equal(A.humbleEntitlementAlias('order-one:product:game-one:0','order-one'),null);
 assert.equal(A.humbleEntitlementAlias('order-one:key:game-one:1','order-one'),'order-one:entitlement:game-one:1');
});
