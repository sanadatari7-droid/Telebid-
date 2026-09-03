"""Opportunity lifecycle: DRAFT -> submit -> 3-level approval -> WON/LOST,
including the maker-checker rule (creator can't approve their own
opportunity unless they're ADMIN, in which case it's allowed but logged
as an override)."""
import pytest


async def _create_opp(client, headers, **overrides):
    payload = {"customer_name": "Lifecycle Test Customer"}
    payload.update(overrides)
    r = await client.post("/api/v1/opportunities-v2", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["opp_id"]


async def test_create_opportunity_assigns_draft_status_and_opp_number(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    opp = r.json()["opportunity"]
    assert opp["status"] == "DRAFT"
    assert opp["opp_number"]


async def test_full_approval_flow_reaches_approved(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])

    submit = await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])
    assert submit.status_code == 200

    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    assert check.json()["opportunity"]["status"] == "PENDING_L1"

    for level in (1, 2, 3):
        r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/approve/{level}",
            json={"decision": "APPROVE", "comments": f"ok level {level}"}, headers=tenant["headers"])
        assert r.status_code == 200, r.text

    final = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    assert final.json()["opportunity"]["status"] == "APPROVED"


async def test_rejection_sends_opportunity_back_to_draft(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])

    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/approve/1",
        json={"decision": "REJECT", "comments": "not viable"}, headers=tenant["headers"])
    assert r.status_code == 200
    assert r.json()["new_status"] == "DRAFT"


async def test_cannot_submit_non_draft_opportunity_twice(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])

    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])
    assert r.status_code == 400


async def test_cannot_approve_at_wrong_level(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])

    # Opportunity is at PENDING_L1 — approving at level 2 should be rejected.
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/approve/2",
        json={"decision": "APPROVE"}, headers=tenant["headers"])
    assert r.status_code == 400


async def test_mark_won_sets_status_and_order_number(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/won", json={
        "won_date": "2026-01-15", "order_number": "PO-99881", "tcv": 250000,
    }, headers=tenant["headers"])
    assert r.status_code == 200, r.text

    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    opp = check.json()["opportunity"]
    assert opp["status"] == "WON"
    assert opp["order_number"] == "PO-99881"


async def test_mark_lost_sets_status_and_reason(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/lost", json={
        "lost_date": "2026-01-15", "loss_reason": "Price too high", "loss_type": "FINANCIAL",
    }, headers=tenant["headers"])
    assert r.status_code == 200, r.text

    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    opp = check.json()["opportunity"]
    assert opp["status"] == "LOST"
    assert opp["loss_reason"] == "Price too high"
