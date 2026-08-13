const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatLocalDate,
  normalizeEmployeeConflicts,
  parseZuperDate
} = require('../lib/zuper-schedule');

test('normalizes Zuper UTC timestamps', () => {
  assert.equal(
    parseZuperDate('2026-08-17 15:00:00').toISOString(),
    '2026-08-17T15:00:00.000Z'
  );
});

test('returns only active jobs and time off for the selected user', () => {
  const conflicts = normalizeEmployeeConflicts({
    data: {
      jobs: [
        {
          scheduled_start_time: '2026-08-17 15:00:00',
          scheduled_end_time: '2026-08-17 16:00:00',
          assigned_users: [{ user_uid: 'brandon' }],
          status: 'Scheduled'
        },
        {
          scheduled_start_time: '2026-08-17 17:00:00',
          scheduled_end_time: '2026-08-17 18:00:00',
          assigned_users: [{ user_uid: 'other' }],
          status: 'Scheduled'
        },
        {
          scheduled_start_time: '2026-08-17 19:00:00',
          scheduled_end_time: '2026-08-17 20:00:00',
          assigned_users: [{ user_uid: 'brandon' }],
          status: 'Cancelled'
        }
      ],
      users: [{
        user_uid: 'brandon',
        timeoff_request: [{
          start_date_time: '2026-08-18 14:00:00',
          end_date_time: '2026-08-18 18:00:00'
        }]
      }]
    }
  }, 'brandon');

  assert.deepEqual(conflicts, [
    {
      start: '2026-08-17T15:00:00.000Z',
      bufferedEnd: '2026-08-17T16:00:00.000Z'
    },
    {
      start: '2026-08-18T14:00:00.000Z',
      bufferedEnd: '2026-08-18T18:00:00.000Z'
    }
  ]);
});

test('formats query dates in the booking timezone', () => {
  assert.equal(
    formatLocalDate(new Date('2026-08-14T02:00:00Z'), 'America/Chicago'),
    '2026-08-13'
  );
});
