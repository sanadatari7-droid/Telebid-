import html
import logging
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

logger = logging.getLogger(__name__)

def _esc(value) -> str:
    """Escape a value before it's interpolated into an HTML email body —
    these templates are built with plain f-strings, so anything derived
    from user input (customer names, opportunity titles, etc.) must be
    escaped here or it renders as live HTML in a real inbox."""
    return html.escape(str(value)) if value is not None else ""

async def _get_smtp_config(company_id: int) -> dict:
    try:
        from app.db.postgres import get_raw_connection
        conn = await get_raw_connection()
        try:
            rows = await conn.fetch(
                "SELECT setting_key,setting_value FROM system_settings WHERE category='EMAIL' AND company_id=$1",
                company_id)
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

async def smtp_configured(company_id: int) -> bool:
    smtp = await _get_smtp_config(company_id)
    return bool(smtp["host"] and smtp["user"])

async def send_email(to: str, subject: str, body_html: str, body_text: str = "", company_id: int = 1) -> bool:
    try:
        smtp = await _get_smtp_config(company_id)
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

async def send_otp_email(to: str, full_name: str, otp_code: str, company_id: int) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:#1e4080;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">TeleBid Enterprise</h1>
        <p style="color:#afc3e8;margin:5px 0 0">Bid &amp; Tender Management System</p>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151;font-size:15px">Hello <strong>{_esc(full_name)}</strong>,</p>
        <p style="color:#6b7280">Your login verification code is:</p>
        <div style="background:white;border:2px solid #1e4080;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1e4080">{_esc(otp_code)}</div>
          <p style="color:#9ca3af;font-size:12px;margin:8px 0 0">Valid for 5 minutes</p>
        </div>
        <p style="color:#6b7280;font-size:13px">If you did not request this, please ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center">TeleBid Enterprise · Secure Procurement Platform</p>
      </div>
    </div>"""
    return await send_email(to, "Your TeleBid Login Code", html, f"Your OTP code is: {otp_code}", company_id=company_id)

async def send_bid_notification(to: str, full_name: str, subject: str, message: str, bid_number: str = "", company_id: int = 1) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:#1e4080;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">TeleBid Enterprise</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151">Hello <strong>{_esc(full_name)}</strong>,</p>
        <p style="color:#374151">{_esc(message)}</p>
        {f'<div style="background:#eff6ff;border-left:4px solid #1e4080;padding:12px;border-radius:4px;margin:16px 0"><strong style="color:#1e4080">{_esc(bid_number)}</strong></div>' if bid_number else ""}
        <p style="color:#6b7280;font-size:12px">Login to TeleBid Enterprise to view details.</p>
      </div>
    </div>"""
    return await send_email(to, subject, html, message, company_id=company_id)

async def send_deadline_reminder(to: str, full_name: str, bid_number: str, bid_title: str, days_left: int, company_id: int = 1) -> bool:
    urgency = "🔴 URGENT" if days_left <= 2 else "🟡 Reminder"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:{'#dc2626' if days_left<=2 else '#f59e0b'};padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">{urgency}: Bid Deadline</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151">Hello <strong>{_esc(full_name)}</strong>,</p>
        <p style="color:#374151">The following bid deadline is approaching:</p>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-weight:bold;color:#1e4080">{_esc(bid_number)}</div>
          <div style="color:#374151;margin:4px 0">{_esc(bid_title)}</div>
          <div style="color:{'#dc2626' if days_left<=2 else '#f59e0b'};font-weight:bold;font-size:18px">{days_left} day{'s' if days_left!=1 else ''} remaining</div>
        </div>
        <p style="color:#6b7280;font-size:12px">Please take action immediately in TeleBid Enterprise.</p>
      </div>
    </div>"""
    return await send_email(to, f"{urgency}: {bid_number} — {days_left} days left", html, company_id=company_id)

async def send_bond_reminder(to: str, full_name: str, opp_number: str, customer_name: str,
                              submission_deadline: str, days_left: int, role: str = "BID_PERSON",
                              company_id: int = 1) -> bool:
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
        <p style="color:#374151;font-size:15px">Hello <strong>{_esc(full_name)}</strong>,</p>
        <p style="color:#6b7280">{_esc(intro)}</p>

        <div style="background:white;border:2px solid {color};border-radius:12px;padding:20px;margin:20px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:45%">Opportunity #</td>
                <td style="padding:8px 0;font-weight:bold;color:#111827">{_esc(opp_number)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Customer</td>
                <td style="padding:8px 0;font-weight:bold;color:#111827;border-top:1px solid #f3f4f6">{_esc(customer_name)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Submission Deadline</td>
                <td style="padding:8px 0;font-weight:bold;color:#dc2626;border-top:1px solid #f3f4f6">{_esc(submission_deadline)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Days Remaining</td>
                <td style="padding:8px 0;font-weight:bold;color:#dc2626;border-top:1px solid #f3f4f6">{days_left} days</td></tr>
          </table>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px;border-radius:4px;margin:16px 0">
          <strong style="color:#92400e">⚡ {_esc(action_text)}</strong>
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
    return await send_email(to, subject, html, text, company_id=company_id)


SEVERITY_STYLE = {
    "CRITICAL": ("#dc2626", "🔴"),
    "HIGH":     ("#f59e0b", "🟠"),
    "MEDIUM":   ("#3b82f6", "🟡"),
    "LOW":      ("#6b7280", "⚪"),
}

async def send_ai_alert_email(to: str, full_name: str, headline: str, reason: str,
                               recommended_action: str, severity: str, opp_number: str,
                               customer_name: str, ai_generated: bool = True,
                               company_id: int = 1) -> bool:
    """AI Alert Watchdog email — delivered through the standard SMTP pipeline
    above, which can be pointed at Outlook/Office 365's SMTP relay via
    SMTP_HOST=smtp.office365.com (see .env / system_settings EMAIL category)."""
    color, dot = SEVERITY_STYLE.get(severity, SEVERITY_STYLE["MEDIUM"])
    source_tag = "AI-Triaged Alert" if ai_generated else "Automated Alert (rule-based)"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px">
      <div style="background:{color};padding:22px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-size:28px">{dot}</div>
        <h1 style="color:white;margin:6px 0 0;font-size:19px">{_esc(headline)}</h1>
        <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:11px;letter-spacing:.5px;text-transform:uppercase">{_esc(source_tag)} · {_esc(severity)}</p>
      </div>
      <div style="background:#f8fafc;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151;font-size:15px">Hello <strong>{_esc(full_name)}</strong>,</p>

        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:14px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:40%">Opportunity #</td>
                <td style="padding:6px 0;font-weight:bold;color:#111827">{_esc(opp_number)}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;border-top:1px solid #f3f4f6">Customer</td>
                <td style="padding:6px 0;font-weight:bold;color:#111827;border-top:1px solid #f3f4f6">{_esc(customer_name)}</td></tr>
          </table>
        </div>

        <p style="color:#374151;margin:14px 0 4px;font-size:13px;font-weight:bold">Why this was flagged</p>
        <p style="color:#4b5563;font-size:14px;margin:0 0 14px">{_esc(reason)}</p>

        <div style="background:#eff6ff;border-left:4px solid {color};padding:12px;border-radius:4px;margin:14px 0">
          <strong style="color:#1e4080;font-size:13px">Recommended action:</strong>
          <span style="color:#374151;font-size:13px"> {_esc(recommended_action)}</span>
        </div>

        <p style="color:#6b7280;font-size:12px;margin-top:20px">Login to TeleBid Enterprise to review and act.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center">TeleBid Enterprise · AI Alert Watchdog</p>
      </div>
    </div>"""
    text = f"{headline}\n\n{opp_number} — {customer_name}\n\nWhy: {reason}\n\nRecommended action: {recommended_action}"
    return await send_email(to, f"[TeleBid Alert] {headline}", html, text, company_id=company_id)

BOND_TYPE_LABELS = {"NEW_BOND": "New Bond", "BID_BOND": "Bid Bond", "FINAL_BOND": "Final Bond"}

async def send_bond_issuance_request(to: str, office_name: str, bond: dict, approvals: list,
                                     company_id: int = 1) -> bool:
    """Formal bond request to the Bid Bond Issuance Office, sent once all three
    approval levels have signed off. `approvals` is [(level_title, approver_name, approved_at)]."""
    type_label = BOND_TYPE_LABELS.get(bond.get("bond_type"), bond.get("bond_type") or "Bond")
    amount = bond.get("bond_amount")
    amount_str = f"{bond.get('currency_code') or ''} {float(amount):,.2f}".strip() if amount is not None else "—"
    pct = bond.get("lg_percentage")
    base = bond.get("lg_base_value")
    pct_str = f"{float(pct):g}% of {float(base):,.2f}" if pct is not None and base is not None else "—"

    rows = [
        ("Opportunity #", bond.get("opp_number")),
        ("Customer", bond.get("customer_name")),
        ("Bid No. (Ref.)", bond.get("bid_ref")),
        ("Bid Subject", bond.get("bid_subject")),
        ("Bond Type", type_label),
        ("Beneficiary", bond.get("beneficiary")),
        ("Beneficiary Address", bond.get("beneficiary_address")),
        ("Bond Amount", amount_str),
        ("Percentage", pct_str),
        ("Language", bond.get("language")),
        ("Submission Date", bond.get("submission_date")),
        ("L/G Validity (Expiry)", bond.get("expiry_date")),
        ("Requester (From)", bond.get("requester_name")),
    ]
    rows_html = "".join(
        f'<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:42%;border-top:1px solid #f3f4f6">{_esc(k)}</td>'
        f'<td style="padding:7px 0;font-weight:bold;color:#111827;border-top:1px solid #f3f4f6">{_esc(v) if v not in (None, "") else "—"}</td></tr>'
        for k, v in rows)
    approvals_html = "".join(
        f'<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:42%">Level {i} — {_esc(title)}</td>'
        f'<td style="padding:6px 0;color:#065f46;font-weight:bold">✓ {_esc(name)} · {_esc(at.strftime("%d %b %Y %H:%M") if at else "")}</td></tr>'
        for i, (title, name, at) in enumerate(approvals, 1))

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px">
      <div style="background:#1e4080;padding:22px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">{_esc(type_label)} Issuance Request</h1>
        <p style="color:#afc3e8;margin:6px 0 0;font-size:13px">{_esc(bond.get("opp_number"))} · {_esc(bond.get("customer_name"))}</p>
      </div>
      <div style="background:#f8fafc;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
        <p style="color:#374151;font-size:15px">Dear <strong>{_esc(office_name)}</strong>,</p>
        <p style="color:#4b5563;font-size:14px">Please issue the following {_esc(type_label.lower())}. It has been approved at all three levels.</p>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:16px 0">
          <table style="width:100%;border-collapse:collapse">{rows_html}</table>
        </div>
        <p style="color:#374151;margin:16px 0 6px;font-size:13px;font-weight:bold">Approvals</p>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px">
          <table style="width:100%;border-collapse:collapse">{approvals_html}</table>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center">Sent automatically by TeleBid Enterprise · Bid Bond Management</p>
      </div>
    </div>"""
    text_lines = [f"{type_label} issuance request — {bond.get('opp_number')} · {bond.get('customer_name')}", ""]
    text_lines += [f"{k}: {v if v not in (None, '') else '—'}" for k, v in rows]
    text_lines += ["", "Approvals:"] + [f"Level {i} — {t}: {n}" for i, (t, n, _) in enumerate(approvals, 1)]
    subject = f"{type_label} Issuance Request — {bond.get('bid_ref') or bond.get('opp_number')}"
    return await send_email(to, subject, html, "\n".join(text_lines), company_id=company_id)
