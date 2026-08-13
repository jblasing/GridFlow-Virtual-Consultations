const CLOSED_STATUSES = new Set(['completed', 'closed', 'cancelled', 'canceled']);

function parseZuperDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? text.replace(' ', 'T') + 'Z'
    : text;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function intervalFrom(object) {
  const start = object.scheduled_start_time || object.scheduled_start ||
    object.start_date_time || object.start_datetime || object.start_time ||
    object.from_date || object.start;
  const end = object.scheduled_end_time || object.scheduled_end ||
    object.end_date_time || object.end_datetime || object.end_time ||
    object.to_date || object.end;
  const parsedStart = parseZuperDate(start);
  const parsedEnd = parseZuperDate(end);
  if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) return null;
  return {
    start: parsedStart.toISOString(),
    bufferedEnd: parsedEnd.toISOString()
  };
}

function containsUser(object, userUid) {
  try {
    return JSON.stringify(object).includes(userUid);
  } catch {
    return false;
  }
}

function statusOf(object) {
  return String(
    object.status || object.job_status || object.status_name ||
    object.current_status || ''
  ).trim().toLowerCase();
}

function collectIntervals(value, predicate, output, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (!Array.isArray(value) && predicate(value)) {
    const interval = intervalFrom(value);
    if (interval) output.push(interval);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectIntervals(child, predicate, output, seen);
    }
  }
}

function normalizeEmployeeConflicts(data, userUid) {
  const output = [];
  const jobs = data?.data?.jobs || [];
  collectIntervals(
    jobs,
    object => containsUser(object, userUid) && !CLOSED_STATUSES.has(statusOf(object)),
    output,
    new Set()
  );

  const users = data?.data?.users || [];
  const user = users.find(item => item?.user_uid === userUid);
  if (user) {
    collectIntervals(
      user.timeoff_request || user.timeoff_requests || [],
      () => true,
      output,
      new Set()
    );
  }

  const unique = new Map();
  for (const interval of output) {
    unique.set(interval.start + '|' + interval.bufferedEnd, interval);
  }
  return [...unique.values()];
}

function formatLocalDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return map.year + '-' + map.month + '-' + map.day;
}

module.exports = {
  formatLocalDate,
  normalizeEmployeeConflicts,
  parseZuperDate
};
