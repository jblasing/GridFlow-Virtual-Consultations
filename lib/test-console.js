const crypto = require('crypto');

function mountTestConsole(app, deps) {
  const { pool, layout, graphToken, sendEmail, resolveZuperApiBase,
    availableSlots, assignAndSchedule, addZuperNote, attachToZuper, hostUpload,
    brandonEmail, sendTestInvitation } = deps;

  const authorized = req => req.query.secret && req.query.secret === process.env.ADMIN_SECRET;
  const clean = value => String(value || '').trim();
  const escape = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  async function ensureAudit() {
    await pool.query(`CREATE TABLE IF NOT EXISTS virtual_consultation_test_runs (
      id BIGSERIAL PRIMARY KEY, test_type TEXT NOT NULL, success BOOLEAN NOT NULL,
      detail TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  }

  async function audit(type, success, detail) {
    await ensureAudit();
    await pool.query(
      'INSERT INTO virtual_consultation_test_runs (test_type, success, detail) VALUES ($1,$2,$3)',
      [type, success, String(detail).slice(0, 1000)]
    );
  }

  function consolePage(secret, result = '') {
    const action = '/admin/tests/run?secret=' + encodeURIComponent(secret);
    return layout('Virtual consultation test console', `<section>
      <p class="eyebrow">Protected administration</p><h1>Integration test console</h1>
      <p>Tests are isolated until you deliberately supply recipients or a Zuper test job.</p>
      ${result ? `<div class="test-result">${result}</div>` : ''}
      <div class="test-grid">
        <form method="post" action="${action}"><h2>1. Configuration</h2>
          <input type="hidden" name="testType" value="configuration"><p>Checks required variables without revealing values.</p><button>Run configuration check</button></form>
        <form method="post" action="${action}"><h2>2. Microsoft Graph</h2>
          <input type="hidden" name="testType" value="graph"><p>Authenticates only. No email is sent.</p><button>Test Graph authentication</button></form>
        <form method="post" action="${action}"><h2>3. Test email</h2>
          <input type="hidden" name="testType" value="email"><label>Recipient</label><input type="email" name="email" required><button>Send test email</button></form>
        <form method="post" action="${action}"><h2>4. Real invitation email</h2>
          <input type="hidden" name="testType" value="invitation"><label>Customer name</label><input name="customerName" required>
          <label>Recipient email</label><input type="email" name="email" required><label>Disposable Zuper job UID</label><input name="jobUid" required>
          <p>Sends the production HTML email with a private scheduling link.</p><button>Send real invitation email</button></form>
        <form method="post" action="${action}"><h2>5. Zuper availability</h2>
          <input type="hidden" name="testType" value="availability"><label>Zuper test job UID</label><input name="jobUid" required><button>Read available slots</button></form>
        <form method="post" enctype="multipart/form-data" action="${action}"><h2>6. Checklist delivery</h2>
          <input type="hidden" name="testType" value="checklist"><label>Zuper test job UID</label><input name="jobUid" required>
          <label>Test image</label><input type="file" name="testImage" accept="image/*" required>
          <label><input type="checkbox" name="confirm" value="CHECKLIST TEST" required> Attach this image and note to the test job, and email Brandon</label><button>Run checklist test</button></form>
        <form method="post" action="${action}"><h2>7. Assignment and scheduling</h2>
          <input type="hidden" name="testType" value="assignment"><label>Zuper test job UID</label><input name="jobUid" required>
          <label>Start (ISO timestamp)</label><input name="start" placeholder="2026-08-14T15:00:00.000Z" required>
          <label>End (ISO timestamp)</label><input name="end" placeholder="2026-08-14T15:45:00.000Z" required>
          <label>Type RUN ZUPER TEST</label><input name="confirm" required><button class="danger">Reassign and schedule test job</button></form>
      </div></section>`);
  }

  app.get('/admin/tests', async (req, res) => {
    if (!authorized(req)) return res.status(401).send('Unauthorized');
    await ensureAudit();
    res.send(consolePage(req.query.secret));
  });

  app.post('/admin/tests/run', deps.testUpload.single('testImage'), async (req, res) => {
    if (!authorized(req)) return res.status(401).send('Unauthorized');
    const type = clean(req.body.testType);
    let detail = '';
    try {
      if (type === 'configuration') {
        const required = ['DATABASE_URL','BOOKING_TOKEN_SECRET','ADMIN_SECRET','INTEGRATION_SECRET',
          'PUBLIC_BASE_URL','ZUPER_COMPANY_NAME','ZUPER_API_KEY','MS_TENANT_ID','MS_CLIENT_ID',
          'MS_CLIENT_SECRET','MS_SENDER_EMAIL'];
        const missing = required.filter(name => !clean(process.env[name]));
        if (missing.length) throw new Error('Missing: ' + missing.join(', '));
        detail = 'All required environment variables are present.';
      } else if (type === 'graph') {
        await graphToken(); detail = 'Microsoft Graph authentication succeeded.';
      } else if (type === 'email') {
        const email = clean(req.body.email); if (!email) throw new Error('Recipient email is required.');
        await sendEmail({ to: email, subject: 'GridFlow virtual consultation test', html: '<h2>Email test passed</h2><p>No customer lead was created.</p>' });
        detail = 'Test email accepted by Microsoft Graph.';
      } else if (type === 'invitation') {
        const customerName = clean(req.body.customerName), email = clean(req.body.email), jobUid = clean(req.body.jobUid);
        if (!customerName || !email || !jobUid) throw new Error('Customer name, recipient email, and disposable job UID are required.');
        const created = await sendTestInvitation({ job_uid: jobUid, customer_name: customerName, customer_email: email, customer_phone: '', source: 'Integration Test' });
        detail = 'Production HTML invitation accepted by Microsoft Graph. Booking link: ' + created.bookingUrl;
      } else if (type === 'availability') {
        const jobUid = clean(req.body.jobUid); if (!jobUid) throw new Error('Test job UID is required.');
        const apiBase = await resolveZuperApiBase();
        const slots = await availableSlots(jobUid);
        detail = `Zuper connected at ${new URL(apiBase).host}; ${slots.length} bookable slot(s) returned.`;
      } else if (type === 'checklist') {
        const jobUid = clean(req.body.jobUid);
        if (req.body.confirm !== 'CHECKLIST TEST' || !jobUid || !req.file) throw new Error('Checklist confirmation, test job UID, and image are required.');
        const url = await hostUpload(req.file, null, 'integrationTest');
        await attachToZuper(jobUid, req.file, url);
        await addZuperNote(jobUid, 'GridFlow virtual consultation checklist integration test. No customer submission.');
        await sendEmail({ to: brandonEmail, subject: 'TEST - pre-virtual checklist delivery', html: '<p>This is an integration test only.</p>', attachments: [req.file] });
        detail = 'Test image/note sent to the Zuper test job and checklist email sent to Brandon.';
      } else if (type === 'assignment') {
        const jobUid = clean(req.body.jobUid), start = clean(req.body.start), end = clean(req.body.end);
        if (req.body.confirm !== 'RUN ZUPER TEST') throw new Error('Confirmation phrase did not match.');
        if (!jobUid || !Date.parse(start) || !Date.parse(end) || Date.parse(end) <= Date.parse(start)) throw new Error('Valid job UID, start, and end are required.');
        await assignAndSchedule(jobUid, new Date(start).toISOString(), new Date(end).toISOString());
        await addZuperNote(jobUid, 'GridFlow virtual consultation assignment/scheduling integration test.');
        detail = 'Test job assigned to Brandon and scheduled.';
      } else {
        throw new Error('Unknown test type.');
      }
      await audit(type, true, detail);
      res.send(consolePage(req.query.secret, '<strong>PASS:</strong> ' + escape(detail)));
    } catch (error) {
      detail = error.message || String(error);
      await audit(type || 'unknown', false, detail).catch(() => {});
      res.status(400).send(consolePage(req.query.secret, '<strong>FAIL:</strong> ' + escape(detail)));
    }
  });
}

module.exports = { mountTestConsole };

