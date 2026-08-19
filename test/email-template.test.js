const test = require('node:test');
const assert = require('node:assert/strict');
const { invitationHtml, LOGO_URL } = require('../lib/email-templates');

test('invitation email includes friendly scheduling links', () => {
  const url = 'https://example.com/book/private-token';
  const html = invitationHtml('John', url);
  assert.match(html, /Schedule My Virtual Estimate/);
  assert.equal(html.split(url).length - 1, 2);
  assert.match(html, /click here to schedule your virtual estimate/i);
  assert.doesNotMatch(html, />https:\/\//);
  assert.match(html, /45-minute virtual generator estimate/);
  assert.match(html, /reschedule or cancel/);
  assert.ok(html.includes(LOGO_URL));
  assert.match(html, /We will review your home/);
  assert.doesNotMatch(html, /â|€™|�/);
});

test('invitation email escapes customer names and URLs', () => {
  const html = invitationHtml('<John & Co>', 'https://example.com/?a=1&b=2');
  assert.doesNotMatch(html, /<John/);
  assert.match(html, /&lt;John &amp; Co&gt;/);
  assert.match(html, /a=1&amp;b=2/);
});

