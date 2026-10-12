import test from 'node:test';
import assert from 'node:assert/strict';
import {moscowSchedule} from '../src/publication-time.js';
const now=Date.parse('2026-10-12T12:00:00Z');
test('Moscow time is explicit independent of browser timezone',()=>assert.equal(moscowSchedule('2026-10-12T17:00',now),'2026-10-12T17:00:00+03:00'));
test('past, malformed and impossible dates cannot enter the plan',()=>{for(const value of ['2026-10-12T14:00','2026-02-30T17:00','2026-10-12T25:00','2026-10-12T17:99','2026-10-12','2028-10-12T17:00'])assert.throws(()=>moscowSchedule(value,now),/INVALID_PLAN_TIME/);});
