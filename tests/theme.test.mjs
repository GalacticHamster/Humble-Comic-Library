import test from 'node:test';
import {themeCoreTests} from './theme-core-tests.mjs';
for(const [name,run]of themeCoreTests)test(name,run);
