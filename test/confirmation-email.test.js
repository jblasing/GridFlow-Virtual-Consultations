const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmationHtml } = require('../lib/confirmation-email');
const { LOGO_URL } = require('../lib/email-templates');

test('confirmation email matches the invitation brand and includes appointment actions', () => {
  const html = confirmationHtml(
    'John Blasing',
    'Friday, August 21, 2026 at 10:00 AM',
    'https://example.com/checklist/private',
    'https://example.com/book/private'
  );
  assert.match(html, /Your consultation is confirmed/);
  assert.match(html, /Friday, August 21, 2026 at 10:00 AM/);
  assert.match(html, /Complete My Pre-Consultation Checklist/);
  assert.match(html, /Reschedule or Cancel/);
  assert.ok(html.includes(LOGO_URL));
  assert.ok(html.includes('https://example.com/checklist/private'));
  assert.ok(html.includes('https://example.com/book/private'));
  assert.match(html, /click here for the checklist/i);
  assert.match(html, /click here to manage your appointment/i);
  assert.doesNotMatch(html, />https:\/\//);
});

test('confirmation email escapes customer-controlled values', () => {
  const html = confirmationHtml('<John & Jane>', 'Friday <10 AM>', 'https://example.com/?a=1&b=2', 'https://example.com/?c=3&d=4');
  assert.ok(!html.includes('<John & Jane>'));
  assert.match(html, /&lt;John &amp; Jane&gt;/);
  assert.match(html, /Friday &lt;10 AM&gt;/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /c=3&amp;d=4/);
});
