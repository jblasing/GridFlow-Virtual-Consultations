const test = require('node:test');
const assert = require('node:assert/strict');
const { invitationHtml } = require('../lib/email-templates');

test('invitation email includes the private scheduling link and fallback URL', () => {
  const url = 'https://example.com/book/private-token';
  const html = invitationHtml('John', url);
  assert.match(html, /Schedule Virtual Consultation/);
  assert.equal(html.split(url).length - 1, 3);
  assert.match(html, /45-minute virtual consultation/);
  assert.match(html, /reschedule or cancel/);
});

test('invitation email escapes customer names and URLs', () => {
  const html = invitationHtml('<John & Co>', 'https://example.com/?a=1&b=2');
  assert.doesNotMatch(html, /<John/);
  assert.match(html, /&lt;John &amp; Co&gt;/);
  assert.match(html, /a=1&amp;b=2/);
});

