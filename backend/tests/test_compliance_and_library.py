"""RFP Compliance Matrix and AI Content Library — manual CRUD paths (which
must work with zero AI configuration) plus the graceful-degradation
contract on the AI-only actions (extract, draft-answer) when
ANTHROPIC_API_KEY isn't set. conftest.py forces the key empty for every
test in this suite, so these 503s are deterministic."""
import pytest


async def _create_opp(client, headers):
    r = await client.post("/api/v1/opportunities-v2", json={"customer_name": "Compliance Test Customer"}, headers=headers)
    assert r.status_code == 201
    return r.json()["opp_id"]


# ── Compliance Matrix ───────────────────────────────────────────────────────

async def test_requirements_list_reports_ai_unavailable(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant["headers"])
    assert r.status_code == 200
    assert r.json()["extraction_available"] is False


async def test_extract_requirements_returns_503_when_unconfigured(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/requirements/extract",
        json={"rfp_text": "The vendor must provide 24/7 support."}, headers=tenant["headers"])
    assert r.status_code == 503


async def test_manual_requirement_add_update_delete(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])

    add = await client.post(f"/api/v1/opportunities-v2/{opp_id}/requirements",
        json={"requirement_text": "ISO 27001 certification required", "category": "Eligibility"},
        headers=tenant["headers"])
    assert add.status_code == 201, add.text
    req = add.json()
    assert req["status"] == "NOT_STARTED"
    assert req["source"] == "MANUAL"

    listing = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant["headers"])
    assert listing.json()["summary"]["NOT_STARTED"] == 1

    update = await client.patch(f"/api/v1/opportunities-v2/{opp_id}/requirements/{req['requirement_id']}",
        json={"status": "MET", "response": "We hold ISO 27001, cert #12345"}, headers=tenant["headers"])
    assert update.status_code == 200

    after = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant["headers"])
    assert after.json()["summary"]["MET"] == 1
    assert after.json()["summary"]["NOT_STARTED"] == 0

    delete = await client.delete(f"/api/v1/opportunities-v2/{opp_id}/requirements/{req['requirement_id']}", headers=tenant["headers"])
    assert delete.status_code == 200
    empty = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant["headers"])
    assert empty.json()["items"] == []


async def test_requirement_status_rejects_invalid_value(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    add = await client.post(f"/api/v1/opportunities-v2/{opp_id}/requirements",
        json={"requirement_text": "Some requirement"}, headers=tenant["headers"])
    req_id = add.json()["requirement_id"]

    r = await client.patch(f"/api/v1/opportunities-v2/{opp_id}/requirements/{req_id}",
        json={"status": "NOT_A_REAL_STATUS"}, headers=tenant["headers"])
    assert r.status_code == 400


# ── Content Library ─────────────────────────────────────────────────────────

async def test_content_library_crud(client, tenant):
    create = await client.post("/api/v1/content-library", json={
        "question": "What SLA do you guarantee?", "answer": "99.9% uptime.",
        "category": "Technical", "tags": "sla,uptime",
    }, headers=tenant["headers"])
    assert create.status_code == 201, create.text
    item_id = create.json()["item_id"]
    assert create.json()["times_used"] == 0

    listing = await client.get("/api/v1/content-library", headers=tenant["headers"])
    assert len(listing.json()["items"]) == 1

    search = await client.get("/api/v1/content-library", params={"search": "SLA"}, headers=tenant["headers"])
    assert len(search.json()["items"]) == 1
    miss = await client.get("/api/v1/content-library", params={"search": "nonexistent-term-xyz"}, headers=tenant["headers"])
    assert len(miss.json()["items"]) == 0

    update = await client.patch(f"/api/v1/content-library/{item_id}", json={"answer": "99.95% uptime, updated."}, headers=tenant["headers"])
    assert update.status_code == 200

    delete = await client.delete(f"/api/v1/content-library/{item_id}", headers=tenant["headers"])
    assert delete.status_code == 200
    empty = await client.get("/api/v1/content-library", headers=tenant["headers"])
    assert empty.json()["items"] == []


async def test_draft_answer_returns_503_when_unconfigured(client, tenant):
    r = await client.post("/api/v1/content-library/draft-answer",
        json={"question": "What is your uptime guarantee?"}, headers=tenant["headers"])
    assert r.status_code == 503
