const SLOT_MINUTES = 45;
const BUFFER_MINUTES = 20;
const BUFFERED_MINUTES = SLOT_MINUTES + BUFFER_MINUTES;
const START_INTERVAL_MINUTES = 120;

const STANDARD_HOURS = {
  1: ["09:00", "19:00"],
  2: ["09:00", "19:00"],
  3: ["09:00", "19:00"],
  4: ["09:00", "19:00"],
  5: ["09:00", "19:00"],
  6: ["10:00", "16:00"]
};

function minutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return (hour * 60) + minute;
}

function localParts(date, timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function localMinuteOfDay(date, timeZone) {
  const parts = localParts(date, timeZone);
  return (Number(parts.hour) * 60) + Number(parts.minute);
}

function localWeekday(date, timeZone) {
  const day = localParts(date, timeZone).weekday;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
}

function hoursFor(date, options = {}) {
  const timeZone = options.timeZone || "America/Chicago";
  const weekday = localWeekday(date, timeZone);

  if (weekday === 0) {
    if (!options.sundayEnabled) return null;
    return [options.sundayStart || "10:00", options.sundayEnd || "16:00"];
  }

  return STANDARD_HOURS[weekday] || null;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function buildBookableSlots({
  now = new Date(),
  assistedSlots = [],
  busyBookings = [],
  timeZone = "America/Chicago",
  sundayEnabled = false,
  sundayStart = "10:00",
  sundayEnd = "16:00",
  minimumNoticeMinutes = 60,
  bookingHorizonDays = 7
} = {}) {
  const earliest = new Date(now.getTime() + (minimumNoticeMinutes * 60000));
  const latest = new Date(now.getTime() + (bookingHorizonDays * 86400000));
  const output = [];

  for (const window of assistedSlots) {
    const windowStart = new Date(window.start);
    const windowEnd = new Date(window.end);

    if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime())) continue;

    let cursor = new Date(Math.max(windowStart.getTime(), earliest.getTime()));
    cursor.setUTCSeconds(0, 0);
    if (cursor.getUTCMinutes() !== 0) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
    }

    while (cursor < windowEnd && cursor <= latest) {
      const appointmentEnd = new Date(cursor.getTime() + (SLOT_MINUTES * 60000));
      const bufferedEnd = new Date(cursor.getTime() + (BUFFERED_MINUTES * 60000));
      const allowedHours = hoursFor(cursor, {
        timeZone,
        sundayEnabled,
        sundayStart,
        sundayEnd
      });

      if (allowedHours) {
        const startMinute = localMinuteOfDay(cursor, timeZone);
        const endMinute = startMinute + SLOT_MINUTES;
        const allowedStart = minutes(allowedHours[0]);
        const allowedEnd = minutes(allowedHours[1]);
        const conflicts = busyBookings.some(booking =>
          overlaps(cursor, bufferedEnd, new Date(booking.start), new Date(booking.bufferedEnd))
        );

        if (
          startMinute >= allowedStart &&
          endMinute <= allowedEnd &&
          appointmentEnd <= windowEnd &&
          !conflicts
        ) {
          output.push({
            start: cursor.toISOString(),
            end: appointmentEnd.toISOString(),
            bufferedEnd: bufferedEnd.toISOString()
          });
        }
      }

      cursor = new Date(cursor.getTime() + (START_INTERVAL_MINUTES * 60000));
    }
  }

  return output;
}

module.exports = {
  SLOT_MINUTES,
  BUFFER_MINUTES,
  buildBookableSlots,
  hoursFor,
  overlaps
};
