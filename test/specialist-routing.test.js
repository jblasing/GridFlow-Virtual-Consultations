const test = require('node:test');
const assert = require('node:assert/strict');
const { selectSpecialist } = require('../lib/specialist-routing');

const brandon = { userUid: 'brandon', name: 'Brandon Whisnant' };
const colt = { userUid: 'colt', name: 'Colt Minneci' };

test('keeps Colt-owned virtual estimates assigned to Colt', () => {
  assert.equal(selectSpecialist(['office', 'colt'], brandon, colt), colt);
});

test('uses Brandon for leads that are not owned by Colt', () => {
  assert.equal(selectSpecialist(['john'], brandon, colt), brandon);
});
