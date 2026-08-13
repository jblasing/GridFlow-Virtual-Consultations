const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBookableSlots, hoursFor, SLOT_MINUTES, BUFFER_MINUTES } = require('../lib/schedule');

test('uses 45 minute appointments and 20 minute buffers', () => {
  assert.equal(SLOT_MINUTES, 45);
  assert.equal(BUFFER_MINUTES, 20);
});

test('Sunday is disabled by default and can be enabled for events', () => {
  const sunday = new Date('2026-08-16T15:00:00Z');
  assert.equal(hoursFor(sunday, { timeZone: 'America/Chicago' }), null);
  assert.deepEqual(
    hoursFor(sunday, {
      timeZone: 'America/Chicago',
      sundayEnabled: true,
      sundayStart: '11:00',
      sundayEnd: '15:00'
    }),
    ['11:00', '15:00']
  );
});

test('creates slots inside weekday hours with one hour notice', () => {
  const slots = buildBookableSlots({
    now: new Date('2026-08-17T13:00:00Z'),
    assistedSlots: [{
      start: '2026-08-17T13:00:00Z',
      end: '2026-08-18T01:00:00Z'
    }],
    timeZone: 'America/Chicago'
  });
  assert.ok(slots.length > 0);
  assert.equal(slots[0].start, '2026-08-17T14:00:00.000Z');
  assert.equal(new Date(slots[0].end) - new Date(slots[0].start), 45 * 60000);
  assert.equal(new Date(slots[0].bufferedEnd) - new Date(slots[0].start), 65 * 60000);
});

test('removes slots that conflict with an existing booking plus buffer', () => {
  const slots = buildBookableSlots({
    now: new Date('2026-08-17T13:00:00Z'),
    assistedSlots: [{
      start: '2026-08-17T14:00:00Z',
      end: '2026-08-17T19:00:00Z'
    }],
    busyBookings: [{
      start: '2026-08-17T15:05:00Z',
      bufferedEnd: '2026-08-17T16:10:00Z'
    }],
    timeZone: 'America/Chicago'
  });
  assert.equal(slots.some(slot => slot.start === '2026-08-17T15:05:00.000Z'), false);
});
