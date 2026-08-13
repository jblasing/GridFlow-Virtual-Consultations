const test = require('node:test');
const assert = require('node:assert/strict');
const { invitationHtml, LOGO_URL } = require('../lib/email-templates');

test('invitation email includes the private scheduling link and fallback URL', () => {
  const url = 'https://example.com/book/private-token';
  const html = invitationHtml('John', url);
  assert.match(html, /Schedule My Virtual Estimate/);
  assert.equal(html.split(url).length - 1, 3);
  assert.match(html, /45-minute virtual generator estimate/);
  assert.match(html, /reschedule or cancel/);
  assert.ok(html.includes(LOGO_URL));
});

test('invitation email escapes customer names and URLs', () => {
  const html = invitationHtml('<John & Co>', 'https://example.com/?a=1&b=2');
  assert.doesNotMatch(html, /<John/);
  assert.match(html, /&lt;John &amp; Co&gt;/);
  assert.match(html, /a=1&amp;b=2/);
});

