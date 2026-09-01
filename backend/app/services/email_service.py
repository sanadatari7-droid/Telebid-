import logging
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

logger = logging.getLogger(__name__)

async def _get_smtp_config() -> dict:
    try:
        from app.db.postgres import get_raw_connection
        conn = await get_raw_connection()
        try:
            rows = await conn.fetch("SELECT setting_key,setting_value FROM system_settings WHERE category='EMAIL' AND company_id=1")
            cfg = {r['setting_key']:r['setting_value'] for r in rows}
        finally:
            await conn.close()
    except Exception:
        cfg = {}
    return {
        "host":       cfg.get("smtp_host")      or settings.SMTP_HOST     or "",
        "port":       int(cfg.get("smtp_port") or settings.SMTP_PORT     or 587),
        "user":       cfg.get("smtp_user")      or settings.SMTP_USER     or "",
        "password":   cfg.get("smtp_password")  or settings.SMTP_PASSWORD or "",
        "from_email": cfg.get("smtp_from_email") or settings.SMTP_FROM   or "",
        "from_name":  cfg.get("smtp_from_name") or "TeleBid Enterprise",
        "use_tls":    (cfg.get("smtp_use_tls","true")).lower()=="true",
        "enabled":    (cfg.get("email_enabled","false")).lower()=="true",
    }

async def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> bool:
    try:
        smtp = await _get_smtp_config()
    except Exception:
        smtp = {"host":settings.SMTP_HOST or "","port":settings.SMTP_PORT or 587,
                "user":settings.SMTP_USER or "","password":settings.SMTP_PASSWORD or "",
                "from_email":settings.SMTP_FROM or "","from_name":"TeleBid Enterprise",
                "use_tls":settings.SMTP_TLS,"enabled":bool(settings.SMTP_HOST)}
    if not smtp["host"] or not smtp["user"]:
        logger.info(f"SMTP not configured — skipping email to {to}: {subject}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{smtp['from_name']} <{smtp['from_email'] or smtp['user']}>"
        msg["To"] = to
        if body_text: msg.attach(MIMEText(body_text,"plain"))
        msg.attach(MIMEText(body_html,"html"))
        await aiosmtplib.send(msg, hostname=smtp["host"], port=smtp["port"],
            username=smtp["user"], password=smtp["password"],
            use_tls=False, start_tls=smtp["use_tls"])
        logger.info(f"Email sent to {to}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False

async def send_otp_email(to: str, full_name: str, otp_code: str) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:#1e4080;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">TeleBid Enterprise</h1>
        <p style="color:#afc3e8;margin:5px 0 0">Bid &amp; Tender Management System</p>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151;font-size:15px">Hello <strong>{full_name}</strong>,</p>
        <p style="color:#6b7280">Your login verification code is:</p>
        <div style="background:white;border:2px solid #1e4080;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1e4080">{otp_code}</div>
          <p style="color:#9ca3af;font-size:12px;margin:8px 0 0">Valid for 5 minutes</p>
        </div>
        <p style="color:#6b7280;font-size:13px">If you did not request this, please ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center">TeleBid Enterprise · Secure Procurement Platform</p>
      </div>
    </div>"""
    return await send_email(to, "Your TeleBid Login Code", html, f"Your OTP code is: {otp_code}")

async def send_bid_notification(to: str, full_name: str, subject: str, message: str, bid_number: str = "") -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:#1e4080;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">TeleBid Enterprise</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151">Hello <strong>{full_name}</strong>,</p>
        <p style="color:#374151">{message}</p>
        {f'<div style="background:#eff6ff;border-left:4px solid #1e4080;padding:12px;border-radius:4px;margin:16px 0"><strong style="color:#1e4080">{bid_number}</strong></div>' if bid_number else ""}
        <p style="color:#6b7280;font-size:12px">Login to TeleBid Enterprise to view details.</p>
      </div>
    </div>"""
    return await send_email(to, subject, html, message)

async def send_deadline_reminder(to: str, full_name: str, bid_number: str, bid_title: str, days_left: int) -> bool:
    urgency = "🔴 URGENT" if days_left <= 2 else "🟡 Reminder"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:{'#dc2626' if days_left<=2 else '#f59e0b'};padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">{urgency}: Bid Deadline</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151">Hello <strong>{full_name}</strong>,</p>
        <p style="color:#374151">The following bid deadline is approaching:</p>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-weight:bold;color:#1e4080">{bid_number}</div>
          <div style="color:#374151;margin:4px 0">{bid_title}</div>
          <div style="color:{'#dc2626' if days_left<=2 else '#f59e0b'};font-weight:bold;font-size:18px">{days_left} day{'s' if days_left!=1 else ''} remaining</div>
        </div>
        <p style="color:#6b7280;font-size:12px">Please take action immediately in TeleBid Enterprise.</p>
      </div>
    </div>"""
    return await send_email(to, f"{urgency}: {bid_number} — {days_left} days left", html)

async def send_bond_reminder(to: str, full_name: str, opp_number: str, customer_name: str,
                              submission_deadline: str, days_left: int, role: str = "BID_PERSON") -> bool:
    """Send bid bond reminder — fires 6 days before submission deadline."""
    if role == "MANAGER":
        subject = f"⚠️ Bond Request Required: {opp_number} — {days_left} Days to Deadline"
        headline = "Bond Request Action Required — Manager Notification"
        color = "#7c3aed"
        intro = f"This is a manager notification. The bid person has been asked to request the bid bond for the following opportunity."
        action_text = "Please ensure the bid bond request has been submitted on time."
    else:
        subject = f"⚠️ Action Required: Request Bid Bond for {opp_number}"
        headline = "Bid Bond Request Required"
        color = "#f59e0b"
        intro = f"A bid bond is required for the following opportunity. Please initiate the bond request immediately."
        action_text = "Log in to TeleBid Enterprise and submit the bid bond request."

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px">
      <div style="background:{color};padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-size:32px">🔔</div>
        <h1 style="color:white;margin:8px 0 0;font-size:20px">{headline}</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151;font-size:15px">Hello <strong>{full_name}</strong>,</p>
        <p style="color:#6b7280">{intro}</p>

        <div style="background:white;border:2px solid {color};border-radius:12px;padding:20px;margin:20px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:45%">Opportunity #</td>
                <td style="padding:8px 0;font-weight:bold;color:#111827">{opp_number}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Customer</td>
                <td style="padding:8px 0;font-weight:bold;color:#111827;border-top:1px solid #f3f4f6">{customer_name}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Submission Deadline</td>
                <td style="padding:8px 0;font-weight:bold;color:#dc2626;border-top:1px solid #f3f4f6">{submission_deadline}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Days Remaining</td>
                <td style="padding:8px 0;font-weight:bold;color:#dc2626;border-top:1px solid #f3f4f6">{days_left} days</td></tr>
          </table>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px;border-radius:4px;margin:16px 0">
          <strong style="color:#92400e">⚡ {action_text}</strong>
        </div>

        <p style="color:#6b7280;font-size:12px;margin-top:24px">
          This is an automated reminder from TeleBid Enterprise.<br>
          Bond reminders are sent 6 days before the submission deadline.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center">TeleBid Enterprise · Bid Bond Management</p>
      </div>
    </div>"""

    text = f"Bond reminder for {opp_number} - {customer_name}. Submission deadline: {submission_deadline}. {days_left} days remaining. {action_text}"
    return await send_email(to, subject, html, text)
