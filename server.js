const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { buildBookableSlots, SLOT_MINUTES, BUFFER_MINUTES } = require('./lib/schedule');
const { mountTestConsole } = require('./lib/test-console');
const { invitationHtml, LOGO_URL } = require('./lib/email-templates');
const { formatLocalDate, normalizeEmployeeConflicts } = require('./lib/zuper-schedule');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, done) => {
    done(null, /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype));
  }
});

const PORT = Number(process.env.PORT || 10000);
const TIME_ZONE = process.env.BOOKING_TIME_ZONE || 'America/Chicago';
const BRANDON_USER_UID = process.env.BRANDON_ZUPER_USER_UID || 'b23bf97c-61c0-42fd-8bed-4687cb4c9fb8';
const BRANDON_TEAM_UID = process.env.ZUPER_SALES_TEAM_UID || '6f2d5184-e739-4253-94db-da7be5f6ea8a';
const BRANDON_EMAIL = process.env.BRANDON_EMAIL || 'bwhisnant@csllc-tx.com';
const BRANDON_NAME = 'Brandon Whisnant';
const PHOTO_FIELDS = [
  'breakerPanel',
  'electricMeter',
  'fuelSource',
  'locationDetail',
  'locationWide'
];

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static('public', { maxAge: '1h' }));

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function signId(id) {
  const signature = crypto
    .createHmac('sha256', required('BOOKING_TOKEN_SECRET'))
    .update(String(id))
    .digest('base64url');
  return Buffer.from(String(id)).toString('base64url') + '.' + signature;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const id = Buffer.from(parts[0], 'base64url').toString('utf8');
  const expected = crypto
    .createHmac('sha256', required('BOOKING_TOKEN_SECRET'))
    .update(id)
    .digest('base64url');
  if (expected.length !== parts[1].length) return null;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1])) ? id : null;
}

async function ensureSchema() {
  await pool.query([
    'CREATE TABLE IF NOT EXISTS virtual_consultation_leads (',
    ' id BIGSERIAL PRIMARY KEY,',
    ' job_uid TEXT NOT NULL UNIQUE,',
    ' customer_name TEXT NOT NULL,',
    ' customer_email TEXT,',
    ' customer_phone TEXT,',
    ' home_address TEXT,',
    ' source TEXT,',
    ' booking_status TEXT NOT NULL DEFAULT \'invited\',',
    ' scheduled_start TIMESTAMPTZ,',
    ' scheduled_end TIMESTAMPTZ,',
    ' checklist_submitted_at TIMESTAMPTZ,',
    ' created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    ' updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    'CREATE INDEX IF NOT EXISTS virtual_consultation_start_idx',
    ' ON virtual_consultation_leads (scheduled_start);',
    'CREATE TABLE IF NOT EXISTS virtual_consultation_settings (',
    ' setting_key TEXT PRIMARY KEY,',
    ' setting_value TEXT NOT NULL,',
    ' updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');'
  ].join(' '));
}

async function setting(key, fallback) {
  const result = await pool.query(
    'SELECT setting_value FROM virtual_consultation_settings WHERE setting_key = $1',
    [key]
  );
  return result.rows[0]?.setting_value ?? fallback;
}

async function resolveZuperApiBase() {
  if (process.env.ZUPER_API_BASE_URL) {
    return String(process.env.ZUPER_API_BASE_URL).replace(/\/$/, '');
  }
  const response = await fetch('https://accounts.zuperpro.com/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company_name: required('ZUPER_COMPANY_NAME') })
  });
  const data = await response.json();
  if (!response.ok || !data?.config?.dc_api_url) {
    throw new Error('Unable to resolve the Zuper API URL.');
  }
  return String(data.config.dc_api_url).replace(/\/$/, '');
}

async function zuperRequest(path, options = {}) {
  const base = await resolveZuperApiBase();
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'x-api-key': required('ZUPER_API_KEY'),
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    throw new Error('Zuper request failed (' + response.status + '): ' + (data?.message || text));
  }
  return data;
}

function normalizeAvailability(data) {
  const availability = data?.data?.availability || [];
  const windows = [];
  for (const day of availability) {
    for (const slot of day.slots || []) {
      const users = slot.users || [];
      const available = users.some(user =>
        (typeof user === 'string' ? user : user.user_uid) === BRANDON_USER_UID
      );
      if (available) {
        const start = String(slot.start_time || '').replace(' ', 'T') + 'Z';
        const end = String(slot.end_time || '').replace(' ', 'T') + 'Z';
        windows.push({ start, end });
      }
    }
  }
  return windows;
}

function formatZuperDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function sameInstant(actual, expected) {
  const actualTime = new Date(actual).getTime();
  const expectedTime = new Date(expected).getTime();
  return Number.isFinite(actualTime) && Math.abs(actualTime - expectedTime) < 1000;
}

function assignedUserUids(job) {
  return (job?.assigned_to || [])
    .map(assignment => typeof assignment === 'string'
      ? assignment
      : assignment?.user_uid || assignment?.user?.user_uid)
    .filter(Boolean);
}

function verifyZuperBooking(response, expectedStart, expectedEnd) {
  const job = response?.data || response?.job || response;
  if (!job || !assignedUserUids(job).includes(BRANDON_USER_UID)) {
    throw new Error('Zuper did not confirm Brandon as an assigned user.');
  }
  if (!sameInstant(job.scheduled_start_time, expectedStart) ||
      !sameInstant(job.scheduled_end_time, expectedEnd)) {
    throw new Error('Zuper did not confirm the requested appointment time.');
  }
}

async function availableSlots() {
  const now = new Date();
  const to = new Date(now.getTime() + (7 * 86400000));
  let assistedSlots;
  let zuperConflicts = [];

  try {
    const params = new URLSearchParams({
      'filter.team_uid': BRANDON_TEAM_UID,
      from_date: formatLocalDate(now, TIME_ZONE),
      to_date: formatLocalDate(to, TIME_ZONE),
      timezone: TIME_ZONE
    });
    const employeeSchedule = await zuperRequest('/api/jobs/employee/schedule?' + params.toString());
    const users = employeeSchedule?.data?.users;
    if (!Array.isArray(users) || !users.some(user => user?.user_uid === BRANDON_USER_UID)) {
      throw new Error('Brandon was not returned by the employee schedule.');
    }

    // The storefront owns the approved business hours. Zuper supplies Brandon's
    // scheduled jobs and time off, which are removed as conflicts below.
    assistedSlots = [{ start: now.toISOString(), end: to.toISOString() }];
    zuperConflicts = normalizeEmployeeConflicts(employeeSchedule, BRANDON_USER_UID);
  } catch (error) {
    console.warn('Employee schedule unavailable; using assisted scheduling fallback:', error.message);
    const params = new URLSearchParams({
      from_date: formatZuperDate(now),
      to_date: formatZuperDate(to),
      job_duration: String(SLOT_MINUTES),
      timezone: TIME_ZONE,
      team_uid: BRANDON_TEAM_UID,
      user_uid: BRANDON_USER_UID,
      consider_holidays: 'true'
    });
    const assisted = await zuperRequest('/api/assisted_scheduling?' + params.toString());
    assistedSlots = normalizeAvailability(assisted);
  }

  const busy = await pool.query(
    [
      'SELECT scheduled_start AS start,',
      ' scheduled_end + ($1::int * INTERVAL \'1 minute\') AS "bufferedEnd"',
      ' FROM virtual_consultation_leads',
      ' WHERE booking_status = \'booked\'',
      ' AND scheduled_start >= NOW() - INTERVAL \'1 day\''
    ].join(' '),
    [BUFFER_MINUTES]
  );
  const sundayEnabled = (await setting('sunday_enabled', 'false')) === 'true';
  return buildBookableSlots({
    now,
    assistedSlots,
    busyBookings: [...zuperConflicts, ...busy.rows],
    timeZone: TIME_ZONE,
    sundayEnabled,
    sundayStart: await setting('sunday_start', '10:00'),
    sundayEnd: await setting('sunday_end', '16:00'),
    minimumNoticeMinutes: 60,
    bookingHorizonDays: 7
  });
}

async function assignAndSchedule(jobUid, start, end) {
  await zuperRequest('/api/jobs/assign', {
    method: 'POST',
    body: JSON.stringify({
      job_uid: jobUid,
      type: 'ASSIGN',
      update_all_jobs: false,
      notify_users: true,
      users: [{
        user_uid: BRANDON_USER_UID,
        team_uid: BRANDON_TEAM_UID,
        is_primary: true
      }]
    })
  });
  await zuperRequest('/api/jobs', {
    method: 'PUT',
    body: JSON.stringify({
      job: {
        job_uid: jobUid,
        scheduled_start_time: formatZuperDate(start),
        scheduled_end_time: formatZuperDate(end),
        job_timezone: TIME_ZONE
      }
    })
  });
  let verificationError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, 500));
    const updated = await zuperRequest('/api/jobs/' + encodeURIComponent(jobUid));
    try {
      verifyZuperBooking(updated, start, end);
      verificationError = null;
      break;
    } catch (error) {
      verificationError = error;
    }
  }
  if (verificationError) throw verificationError;
  console.info('Zuper virtual consultation scheduled:', JSON.stringify({
    job_uid: jobUid,
    user_uid: BRANDON_USER_UID,
    scheduled_start_time: start,
    scheduled_end_time: end
  }));
}

async function addZuperNote(jobUid, note) {
  try {
    await zuperRequest('/api/jobs/' + encodeURIComponent(jobUid) + '/note', {
      method: 'POST',
      body: JSON.stringify({ note: { note, is_private: false } })
    });
  } catch (error) {
    console.warn('Zuper note warning:', error.message);
  }
}

async function attachToZuper(jobUid, file) {
  try {
    await zuperRequest('/api/jobs/' + encodeURIComponent(jobUid) + '/attachments', {
      method: 'POST',
      body: JSON.stringify({
        attachment: {
          attachment_name: file.originalname,
          attachment_type: file.mimetype,
          attachment_data: file.buffer.toString('base64')
        }
      })
    });
  } catch (error) {
    console.warn('Zuper attachment warning:', error.message);
  }
}

async function graphToken() {
  const tenant = required('MS_TENANT_ID');
  const response = await fetch(
    'https://login.microsoftonline.com/' + encodeURIComponent(tenant) + '/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: required('MS_CLIENT_ID'),
        client_secret: required('MS_CLIENT_SECRET'),
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error('Microsoft Graph authentication failed.');
  return data.access_token;
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!to) return;
  const token = await graphToken();
  const sender = required('MS_SENDER_EMAIL');
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(sender) + '/sendMail',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: attachments.map(file => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: file.originalname,
            contentType: file.mimetype,
            contentBytes: file.buffer.toString('base64')
          }))
        },
        saveToSentItems: true
      })
    }
  );
  if (!response.ok) throw new Error('Email delivery failed: ' + response.status);
}

async function sendSms(to, body) {
  const phone = String(to || '').replace(/\D/g, '');
  if (!phone) return;
  const account = required('TWILIO_ACCOUNT_SID');
  const auth = Buffer.from(account + ':' + required('TWILIO_AUTH_TOKEN')).toString('base64');
  const response = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + account + '/Messages.json',
    {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + auth,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: phone.length === 10 ? '+1' + phone : '+' + phone,
        From: required('TWILIO_FROM_NUMBER'),
        Body: body
      })
    }
  );
  if (!response.ok) throw new Error('SMS delivery failed: ' + response.status);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date(value));
}

function layout(title, body) {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>', htmlEscape(title), '</title>',
    '<link rel="stylesheet" href="/assets/styles.css?v=20260813-2"></head><body>',
    '<header><img class="site-logo" src="', LOGO_URL, '" width="92" height="62" style="width:92px;height:62px;max-width:92px;max-height:62px;object-fit:contain;background:#fff;border-radius:8px;padding:5px" alt="Collaborative Services"><div><div class="brand">Collaborative Services</div>',
    '<div class="subbrand">Virtual Generator Estimate</div></div></header>',
    '<main>', body, '</main>',
    '<footer>Collaborative Services · (936) 228-2916</footer>',
    '</body></html>'
  ].join('');
}

async function leadFromToken(token) {
  const id = verifyToken(token);
  if (!id) return null;
  const result = await pool.query(
    'SELECT * FROM virtual_consultation_leads WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

app.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', scheduling: true, checklist: true });
});

async function createInvitation(lead, channels = { email: true, sms: true }) {
  if (!lead.job_uid || !lead.customer_name) {
    const error = new Error('job_uid and customer_name are required');
    error.statusCode = 400;
    throw error;
  }
  const result = await pool.query(
    [
      'INSERT INTO virtual_consultation_leads',
      '(job_uid, customer_name, customer_email, customer_phone, home_address, source)',
      'VALUES ($1,$2,$3,$4,$5,$6)',
      'ON CONFLICT (job_uid) DO UPDATE SET',
      'customer_email = COALESCE(EXCLUDED.customer_email, virtual_consultation_leads.customer_email),',
      'customer_phone = COALESCE(EXCLUDED.customer_phone, virtual_consultation_leads.customer_phone),',
      'updated_at = NOW() RETURNING *'
    ].join(' '),
    [
      lead.job_uid,
      lead.customer_name,
      lead.customer_email || '',
      lead.customer_phone || '',
      lead.home_address || '',
      lead.source || ''
    ]
  );
  const stored = result.rows[0];
  const bookingUrl = publicBaseUrl() + '/book/' + signId(stored.id);
  const deliveries = [];
  if (channels.email) deliveries.push(sendEmail({
    to: stored.customer_email,
    subject: 'Schedule Your Virtual Generator Estimate',
    html: invitationHtml(stored.customer_name, bookingUrl)
  }));
  if (channels.sms) deliveries.push(sendSms(
    stored.customer_phone,
    'Collaborative Services: Schedule your virtual generator estimate: ' + bookingUrl
  ));
  const outcomes = await Promise.allSettled(deliveries);
  const failed = outcomes.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  return { stored, bookingUrl };
}

app.post('/api/invitations', async (req, res) => {
  if (req.headers['x-gridflow-secret'] !== process.env.INTEGRATION_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const created = await createInvitation(req.body || {});
    res.status(201).json({ success: true, booking_url: created.bookingUrl });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/book/:token', async (req, res) => {
  const lead = await leadFromToken(req.params.token);
  if (!lead) return res.status(404).send(layout('Link unavailable', '<section><h1>This booking link is unavailable.</h1></section>'));
  const slots = await availableSlots();
  const dates = new Map();
  for (const slot of slots) {
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(slot.start));
    if (!dates.has(dateKey)) dates.set(dateKey, []);
    dates.get(dateKey).push(slot);
  }
  const dateButtons = [...dates.entries()].map(([dateKey, daySlots], index) => {
    const date = new Date(daySlots[0].start);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
    const month = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short' }).format(date);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, day: 'numeric' }).format(date);
    return '<button type="button" class="calendar-day ' + (index === 0 ? 'active' : '') + '" data-date="' + htmlEscape(dateKey) + '"><span>' + htmlEscape(weekday) + '</span><strong>' + htmlEscape(day) + '</strong><small>' + htmlEscape(month) + '</small></button>';
  }).join('');
  const timeGroups = [...dates.entries()].map(([dateKey, daySlots], index) => {
    const times = daySlots.map((slot, slotIndex) => {
      const time = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(slot.start));
      return '<label class="time-choice"><input type="radio" name="start" value="' + htmlEscape(slot.start) + '" ' + (index === 0 && slotIndex === 0 ? 'checked' : '') + ' required><span>' + htmlEscape(time) + '</span></label>';
    }).join('');
    return '<div class="time-panel ' + (index === 0 ? 'active' : '') + '" data-date="' + htmlEscape(dateKey) + '">' + times + '</div>';
  }).join('');
  const current = lead.booking_status === 'booked' ? '<div class="notice">Currently scheduled for <strong>' + htmlEscape(formatDate(lead.scheduled_start)) + '</strong>.</div>' : '';
  res.send(layout('Schedule virtual generator estimate', [
    '<section class="calendar-card"><p class="eyebrow">Virtual generator estimate</p>',
    '<h1>Schedule with Collaborative Services</h1>',
    '<p>Choose a date and time for your 45-minute virtual estimate. Times shown in Central Time.</p>', current,
    slots.length ? '<form method="post" action="/book/' + htmlEscape(req.params.token) + '"><div class="calendar-shell"><div class="calendar-heading"><strong>Select a date</strong><span>Next 7 days</span></div><div class="calendar-days">' + dateButtons + '</div><div class="calendar-heading"><strong>Select a time</strong><span>Central Time</span></div>' + timeGroups + '</div><button type="submit">Reserve virtual estimate</button></form>' : '<div class="notice">No appointments are currently available. Please check again or call (936) 228-2916.</div>',
    lead.booking_status === 'booked' ? '<form method="post" action="/book/' + htmlEscape(req.params.token) + '/cancel"><button class="secondary">Cancel appointment</button></form>' : '',
    '<script>document.querySelectorAll(".calendar-day").forEach(function(button){button.addEventListener("click",function(){document.querySelectorAll(".calendar-day,.time-panel").forEach(function(item){item.classList.remove("active")});button.classList.add("active");document.querySelector(".time-panel[data-date=\\\""+button.dataset.date+"\\\"]").classList.add("active")})})</script>',
    '</section>'
  ].join('')));
});

app.post('/book/:token', async (req, res) => {
  const lead = await leadFromToken(req.params.token);
  if (!lead) return res.status(404).send(layout('Link unavailable', '<section><h1>This booking link is unavailable.</h1></section>'));
  const slots = await availableSlots();
  const selected = slots.find(slot => slot.start === req.body.start);
  if (!selected) {
    return res.status(409).send(layout('Time unavailable', '<section><h1>That appointment is no longer available.</h1><p>Please return to the booking page and choose another time.</p></section>'));
  }
  try {
    await assignAndSchedule(lead.job_uid, selected.start, selected.end);
  } catch (error) {
    console.error('Zuper booking update failed:', error);
    return res.status(502).send(layout(
      'Appointment not completed',
      '<section><h1>We could not complete this appointment.</h1><p>The selected time was not reserved. Please return to the scheduling page and try again, or call (936) 228-2916.</p><a class="button" href="/book/' + htmlEscape(req.params.token) + '">Choose another time</a></section>'
    ));
  }
  await pool.query(
    [
      'UPDATE virtual_consultation_leads SET booking_status = \'booked\',',
      'scheduled_start = $1, scheduled_end = $2, updated_at = NOW() WHERE id = $3'
    ].join(' '),
    [selected.start, selected.end, lead.id]
  );
  const checklist = publicBaseUrl() + '/checklist/' + req.params.token;
  const manage = publicBaseUrl() + '/book/' + req.params.token;
  await Promise.allSettled([
    sendEmail({
      to: lead.customer_email,
      subject: 'Your virtual generator estimate is scheduled',
      html: '<h2>Your consultation is confirmed</h2><p>' + htmlEscape(formatDate(selected.start)) + '</p><p><a href="' + htmlEscape(checklist) + '">Complete the pre-consultation checklist</a></p><p><a href="' + htmlEscape(manage) + '">Reschedule or cancel</a></p>'
    }),
    sendSms(lead.customer_phone, 'Your virtual generator estimate with Collaborative Services is confirmed for ' + formatDate(selected.start) + '. Complete the checklist: ' + checklist),
    sendEmail({
      to: BRANDON_EMAIL,
      subject: 'New virtual generator consultation: ' + lead.customer_name,
      html: '<h2>New virtual consultation</h2><p>' + htmlEscape(lead.customer_name) + '</p><p>' + htmlEscape(formatDate(selected.start)) + '</p><p>Zuper job: ' + htmlEscape(lead.job_uid) + '</p>'
    }),
    addZuperNote(lead.job_uid, 'Customer scheduled a virtual consultation with ' + BRANDON_NAME + ' for ' + formatDate(selected.start) + '.')
  ]);
  res.send(layout('Appointment confirmed', '<section><h1>You are scheduled.</h1><p>' + htmlEscape(formatDate(selected.start)) + '</p><a class="button" href="' + htmlEscape(checklist) + '">Complete the pre-virtual checklist</a></section>'));
});

app.post('/book/:token/cancel', async (req, res) => {
  const lead = await leadFromToken(req.params.token);
  if (!lead) return res.status(404).send(layout('Link unavailable', '<section><h1>This booking link is unavailable.</h1></section>'));
  await pool.query(
    'UPDATE virtual_consultation_leads SET booking_status = \'cancelled\', scheduled_start = NULL, scheduled_end = NULL, updated_at = NOW() WHERE id = $1',
    [lead.id]
  );
  await Promise.allSettled([
    sendEmail({ to: lead.customer_email, subject: 'Virtual consultation cancelled', html: '<p>Your virtual generator consultation has been cancelled.</p>' }),
    sendSms(lead.customer_phone, 'Your Collaborative Services virtual generator consultation has been cancelled.'),
    sendEmail({ to: BRANDON_EMAIL, subject: 'Virtual consultation cancelled: ' + lead.customer_name, html: '<p>The customer cancelled their virtual consultation.</p>' }),
    addZuperNote(lead.job_uid, 'Customer cancelled the virtual consultation.')
  ]);
  res.send(layout('Appointment cancelled', '<section><h1>Your appointment has been cancelled.</h1><a class="button" href="/book/' + htmlEscape(req.params.token) + '">Schedule another time</a></section>'));
});

app.get('/checklist/:token', async (req, res) => {
  const lead = await leadFromToken(req.params.token);
  if (!lead) return res.status(404).send(layout('Link unavailable', '<section><h1>This checklist link is unavailable.</h1></section>'));
  res.send(layout('Pre-virtual checklist', [
    '<section><p class="eyebrow">Prepare for your consultation</p><h1>Pre-virtual checklist</h1>',
    '<p>Take the photos from your phone. Clear, well-lit images help Brandon prepare.</p>',
    '<form method="post" enctype="multipart/form-data" action="/checklist/', htmlEscape(req.params.token), '">',
    '<label>Confirm home address</label><input name="homeAddress" required value="', htmlEscape(lead.home_address), '">',
    '<label>Approximate house square footage</label><input name="squareFootage" type="number" min="200" max="50000" required>',
    '<label>Available gas</label><select name="gasType" required><option value="Natural gas">Natural gas</option><option value="Propane">Propane</option></select>',
    '<label>Main breaker panel with breakers visible</label><input type="file" name="breakerPanel" accept="image/*" capture="environment" required>',
    '<label>Electric meter close-up showing the electric company</label><input type="file" name="electricMeter" accept="image/*" capture="environment" required>',
    '<label>Gas meter and regulator, or propane tank(s)</label><input type="file" name="fuelSource" accept="image/*" capture="environment" required>',
    '<label>Desired generator location showing measurements, walls, windows, doors, vents and clearances</label><input type="file" name="locationDetail" accept="image/*" capture="environment" required>',
    '<label>Wide photo of the requested generator location</label><input type="file" name="locationWide" accept="image/*" capture="environment" required>',
    '<button type="submit">Send checklist to Brandon</button></form></section>'
  ].join('')));
});

app.post('/checklist/:token', upload.fields(PHOTO_FIELDS.map(name => ({ name, maxCount: 1 }))), async (req, res) => {
  const lead = await leadFromToken(req.params.token);
  if (!lead) return res.status(404).send(layout('Link unavailable', '<section><h1>This checklist link is unavailable.</h1></section>'));
  const files = PHOTO_FIELDS.map(name => req.files?.[name]?.[0]).filter(Boolean);
  if (files.length !== PHOTO_FIELDS.length) {
    return res.status(400).send(layout('Photos required', '<section><h1>Please include all five requested photos.</h1></section>'));
  }
  const summary = [
    'Pre-virtual consultation checklist',
    'Customer: ' + lead.customer_name,
    'Home address: ' + req.body.homeAddress,
    'House square footage: ' + req.body.squareFootage,
    'Available gas: ' + req.body.gasType,
    'Photos attached: main breaker panel, electric meter, gas/propane source, location detail, wide location.'
  ].join('\n');
  await Promise.all(files.map(file => attachToZuper(lead.job_uid, file)));
  await Promise.allSettled([
    addZuperNote(lead.job_uid, summary),
    sendEmail({
      to: BRANDON_EMAIL,
      subject: 'Pre-virtual checklist: ' + lead.customer_name,
      html: '<h2>Pre-virtual checklist</h2><p><strong>Address:</strong> ' + htmlEscape(req.body.homeAddress) + '</p><p><strong>Square footage:</strong> ' + htmlEscape(req.body.squareFootage) + '</p><p><strong>Gas:</strong> ' + htmlEscape(req.body.gasType) + '</p><p>Zuper job: ' + htmlEscape(lead.job_uid) + '</p>',
      attachments: files
    })
  ]);
  await pool.query(
    'UPDATE virtual_consultation_leads SET home_address = $1, checklist_submitted_at = NOW(), updated_at = NOW() WHERE id = $2',
    [req.body.homeAddress, lead.id]
  );
  res.send(layout('Checklist received', '<section><h1>Thank you—your checklist was sent to Brandon.</h1><p>He will review everything before your consultation.</p></section>'));
});

mountTestConsole(app, {
  pool,
  layout,
  graphToken,
  sendEmail,
  sendSms,
  resolveZuperApiBase,
  availableSlots,
  assignAndSchedule,
  addZuperNote,
  attachToZuper,
  brandonEmail: BRANDON_EMAIL,
  testUpload: upload,
  sendTestInvitation: lead => createInvitation(lead, { email: true, sms: false })
});

app.get('/admin/sunday', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
  const enabled = (await setting('sunday_enabled', 'false')) === 'true';
  const start = await setting('sunday_start', '10:00');
  const end = await setting('sunday_end', '16:00');
  res.send(layout('Sunday event hours', '<section><h1>Sunday event hours</h1><form method="post" action="/admin/sunday?secret=' + encodeURIComponent(req.query.secret) + '"><label><input type="checkbox" name="enabled" ' + (enabled ? 'checked' : '') + '> Enable Sunday appointments</label><label>Start</label><input type="time" name="start" value="' + htmlEscape(start) + '"><label>End</label><input type="time" name="end" value="' + htmlEscape(end) + '"><button>Save</button></form></section>'));
});

app.post('/admin/sunday', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
  const values = {
    sunday_enabled: req.body.enabled ? 'true' : 'false',
    sunday_start: req.body.start || '10:00',
    sunday_end: req.body.end || '16:00'
  };
  for (const [key, value] of Object.entries(values)) {
    await pool.query(
      'INSERT INTO virtual_consultation_settings (setting_key, setting_value) VALUES ($1,$2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()',
      [key, value]
    );
  }
  res.redirect('/admin/sunday?secret=' + encodeURIComponent(req.query.secret));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send(layout('Something went wrong', '<section><h1>We could not complete that request.</h1><p>Please call (936) 228-2916 for assistance.</p></section>'));
});

ensureSchema()
  .then(() => app.listen(PORT, () => console.log('Virtual consultation service running on port ' + PORT)))
  .catch(error => {
    console.error('Startup failed:', error);
    process.exit(1);
  });
