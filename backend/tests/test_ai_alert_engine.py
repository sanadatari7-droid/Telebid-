"""AI Alert Watchdog: pure unit tests on the signal-detection rules (no DB
needed), plus an integration test of the scan endpoint's cooldown/de-dup
behavior against real data — the same scenario manually verified live
when this feature was built (an opportunity that trips all four signals
at once)."""
from datetime import datetime, timedelta, timezone

import pytest

from app.services import ai_alert_engine as engine


def _base_opp(**overrides):
    now = datetime.now(timezone.utc)
    opp = {
        "submission_deadline": now + timedelta(days=30),
        "updated_at": now - timedelta(days=1),
        "status": "DRAFT",
        "tcv": 10000,
        "has_costing_lines": True,
    }
    opp.update(overrides)
    return opp


def test_no_signals_for_healthy_opportunity():
    now = datetime.now(timezone.utc)
    assert engine._detect_signals(_base_opp(), now) == []


def test_deadline_risk_signal_fires_within_window():
    now = datetime.now(timezone.utc)
    opp = _base_opp(submission_deadline=now + timedelta(days=3))
    assert "DEADLINE_RISK" in engine._detect_signals(opp, now)


def test_deadline_risk_does_not_fire_past_window():
    now = datetime.now(timezone.utc)
    opp = _base_opp(submission_deadline=now + timedelta(days=10))
    assert "DEADLINE_RISK" not in engine._detect_signals(opp, now)


def test_stalled_signal_fires_after_a_week_idle():
    now = datetime.now(timezone.utc)
    opp = _base_opp(updated_at=now - timedelta(days=9))
    assert "STALLED" in engine._detect_signals(opp, now)


def test_missing_costing_signal_requires_both_deadline_and_no_lines():
    now = datetime.now(timezone.utc)
    close_deadline_no_costing = _base_opp(submission_deadline=now + timedelta(days=5), has_costing_lines=False)
    assert "MISSING_COSTING" in engine._detect_signals(close_deadline_no_costing, now)

    close_deadline_has_costing = _base_opp(submission_deadline=now + timedelta(days=5), has_costing_lines=True)
    assert "MISSING_COSTING" not in engine._detect_signals(close_deadline_has_costing, now)


def test_high_value_idle_requires_both_tcv_and_idle_time():
    now = datetime.now(timezone.utc)
    big_and_idle = _base_opp(tcv=750000, updated_at=now - timedelta(days=9))
    assert "HIGH_VALUE_IDLE" in engine._detect_signals(big_and_idle, now)

    small_and_idle = _base_opp(tcv=1000, updated_at=now - timedelta(days=9))
    assert "HIGH_VALUE_IDLE" not in engine._detect_signals(small_and_idle, now)


def test_no_signals_fire_for_terminal_status():
    """A WON/LOST/DROPPED/CANCELLED opportunity should never generate an
    alert, even if every other condition is met."""
    now = datetime.now(timezone.utc)
    opp = _base_opp(
        status="WON", submission_deadline=now + timedelta(days=1),
        updated_at=now - timedelta(days=30), tcv=999999, has_costing_lines=False,
    )
    assert engine._detect_signals(opp, now) == []


# ── Integration: scan endpoint + cooldown de-dup ────────────────────────────

async def _create_opp(client, headers):
    r = await client.post("/api/v1/opportunities-v2", json={"customer_name": "Alert Engine Test Customer"}, headers=headers)
    assert r.status_code == 201
    return r.json()["opp_id"]


async def test_scan_finds_and_logs_signals_then_cooldown_kicks_in(client, tenant, db_conn):
    opp_id = await _create_opp(client, tenant["headers"])

    # Directly age the opportunity so it trips all four signals at once —
    # mirrors the manual DB fixture used when this feature was verified live.
    await db_conn.execute("""
        UPDATE opportunities_v2
        SET submission_deadline = NOW() + INTERVAL '3 days',
            updated_at = NOW() - INTERVAL '9 days',
            tcv = 750000
        WHERE opp_id = $1
    """, opp_id)

    first = await client.post("/api/v1/scheduler/scan-ai-alerts", headers=tenant["headers"])
    assert first.status_code == 200
    assert first.json()["details"]["candidates_found"] == 1
    assert first.json()["details"]["ai_used"] is False  # ANTHROPIC_API_KEY is empty in tests

    history = await client.get("/api/v1/scheduler/ai-alerts", headers=tenant["headers"])
    first_types = {item["alert_type"] for item in history.json()["items"]}
    assert first_types == {"DEADLINE_RISK"}  # only the first untried signal is alerted per scan

    # Running again immediately alerts the NEXT untried signal for the same
    # opportunity (not a duplicate of DEADLINE_RISK, which is in cooldown).
    second = await client.post("/api/v1/scheduler/scan-ai-alerts", headers=tenant["headers"])
    assert second.status_code == 200
    history2 = await client.get("/api/v1/scheduler/ai-alerts", headers=tenant["headers"])
    second_types = {item["alert_type"] for item in history2.json()["items"]}
    assert second_types.issuperset(first_types)
    assert len(second_types) == 2

    # Two more scans alert the remaining two signal types (4 total: DEADLINE_RISK,
    # STALLED, MISSING_COSTING, HIGH_VALUE_IDLE). Once all four have each been
    # alerted once, a further scan finds nothing new to send for this opportunity.
    await client.post("/api/v1/scheduler/scan-ai-alerts", headers=tenant["headers"])
    await client.post("/api/v1/scheduler/scan-ai-alerts", headers=tenant["headers"])
    fifth = await client.post("/api/v1/scheduler/scan-ai-alerts", headers=tenant["headers"])
    assert fifth.json()["details"]["skipped_cooldown"] == 1
    assert fifth.json()["details"]["alerts_sent"] == 0

    all_types = await client.get("/api/v1/scheduler/ai-alerts", headers=tenant["headers"])
    assert {i["alert_type"] for i in all_types.json()["items"]} == {
        "DEADLINE_RISK", "STALLED", "MISSING_COSTING", "HIGH_VALUE_IDLE",
    }
