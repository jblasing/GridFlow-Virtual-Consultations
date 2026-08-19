const { LOGO_URL } = require('./email-templates');

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function confirmationHtml(name, appointmentText, checklistUrl, manageUrl) {
  const safeName = escapeHtml(name || 'there');
  const safeAppointment = escapeHtml(appointmentText);
  const safeChecklistUrl = escapeHtml(checklistUrl);
  const safeManageUrl = escapeHtml(manageUrl);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#1e2933">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f7;padding:24px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #dfe4e8">
<tr><td style="background:#17242d;padding:18px 30px"><img src="${LOGO_URL}" width="150" alt="Collaborative Services" style="display:block;max-width:150px;height:auto;background:#fff;border-radius:8px;padding:6px"></td></tr>
<tr><td style="padding:36px 30px 18px">
<div style="font-size:13px;color:#f4511e;font-weight:800;text-transform:uppercase;letter-spacing:1px">Your virtual generator estimate</div>
<h1 style="font-size:30px;line-height:1.15;margin:10px 0 18px;color:#111820">Your consultation is confirmed.</h1>
<p style="font-size:17px;line-height:1.6;margin:0 0 16px">Hi ${safeName},</p>
<p style="font-size:17px;line-height:1.6;margin:0 0 20px">Your virtual generator estimate with Collaborative Services is scheduled. We look forward to learning about your home and helping you plan the right generator solution.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f8fafb;border:1px solid #e2e7ea;border-left:5px solid #f4511e;border-radius:8px"><tr><td style="padding:18px 20px"><div style="font-size:12px;color:#687782;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Appointment</div><div style="font-size:20px;line-height:1.4;color:#17242d;font-weight:800">${safeAppointment}</div><div style="font-size:13px;color:#687782;margin-top:5px">Times shown in Central Time</div></td></tr></table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr><td bgcolor="#f4511e" style="border-radius:8px"><a href="${safeChecklistUrl}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-size:17px;font-weight:800">Complete My Pre-Consultation Checklist</a></td></tr></table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px"><tr><td style="border:2px solid #17242d;border-radius:8px"><a href="${safeManageUrl}" style="display:inline-block;padding:13px 22px;color:#17242d;text-decoration:none;font-size:16px;font-weight:800">Reschedule or Cancel</a></td></tr></table>
<p style="font-size:14px;line-height:1.6;color:#596773;margin:0">The checklist asks for a few home details and five photos so our team can prepare before your appointment.</p>
</td></tr>
<tr><td style="background:#f8fafb;border-top:1px solid #e5e9ec;padding:22px 30px"><div style="font-weight:800;color:#17242d">Before your appointment</div><ol style="padding-left:20px;margin:10px 0 0;color:#4e5d68;font-size:14px;line-height:1.7"><li>Complete the home and photo checklist.</li><li>Keep your phone or computer available at the scheduled time.</li><li>Have any generator questions ready for our consultation.</li></ol></td></tr>
<tr><td style="padding:20px 30px;color:#71808c;font-size:12px;line-height:1.6;word-break:break-all">If a button does not open, copy one of these private links into your browser:<br><strong>Checklist:</strong> <a href="${safeChecklistUrl}" style="color:#d94a16">${safeChecklistUrl}</a><br><strong>Manage appointment:</strong> <a href="${safeManageUrl}" style="color:#d94a16">${safeManageUrl}</a></td></tr>
<tr><td style="background:#17242d;padding:18px 30px;color:#cad2d8;font-size:12px;line-height:1.5">Collaborative Services &nbsp;|&nbsp; (936) 228-2916<br>This confirmation was sent regarding your whole-home generator inquiry.</td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = { confirmationHtml };
