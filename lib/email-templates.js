const LOGO_URL = 'https://raw.githubusercontent.com/jblasing/company-assets/main/logo.png';

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function invitationHtml(name, bookingUrl) {
  const safeName = escapeHtml(name || 'there');
  const safeUrl = escapeHtml(bookingUrl);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#1e2933">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f7;padding:24px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #dfe4e8">
<tr><td style="background:#17242d;padding:18px 30px"><img src="${LOGO_URL}" width="150" alt="Collaborative Services" style="display:block;max-width:150px;height:auto;background:#fff;border-radius:8px;padding:6px"></td></tr>
<tr><td style="padding:36px 30px 18px">
<div style="font-size:13px;color:#f4511e;font-weight:800;text-transform:uppercase;letter-spacing:1px">Your virtual generator estimate</div>
<h1 style="font-size:30px;line-height:1.15;margin:10px 0 18px;color:#111820">Get a professional generator estimate from home.</h1>
<p style="font-size:17px;line-height:1.6;margin:0 0 16px">Hi ${safeName},</p>
<p style="font-size:17px;line-height:1.6;margin:0 0 18px">Schedule a 45-minute virtual generator estimate with Collaborative Services. We will review your home, power needs, fuel options, and preferred installation area.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td bgcolor="#f4511e" style="border-radius:8px"><a href="${safeUrl}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-size:17px;font-weight:800">Schedule My Virtual Estimate</a></td></tr></table>
<p style="font-size:14px;line-height:1.6;color:#596773;margin:0 0 8px">Choose an available date and time from our calendar. You can reschedule or cancel later using the same private link.</p>
<p style="font-size:13px;line-height:1.5;color:#71808c;margin:18px 0 0">If the button does not open, <a href="${safeUrl}" style="color:#d94a16;font-weight:700">click here to schedule your virtual estimate</a>.</p>
</td></tr>
<tr><td style="background:#f8fafb;border-top:1px solid #e5e9ec;padding:22px 30px"><div style="font-weight:800;color:#17242d">What happens next?</div><ol style="padding-left:20px;margin:10px 0 0;color:#4e5d68;font-size:14px;line-height:1.7"><li>Choose a date and time from the calendar.</li><li>Complete the short home and photo checklist.</li><li>Meet virtually with Collaborative Services to review your project.</li></ol></td></tr>
<tr><td style="background:#17242d;padding:18px 30px;color:#cad2d8;font-size:12px;line-height:1.5">Collaborative Services &nbsp;|&nbsp; (936) 228-2916<br>This invitation was sent regarding your whole-home generator inquiry.</td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = { invitationHtml, LOGO_URL };

