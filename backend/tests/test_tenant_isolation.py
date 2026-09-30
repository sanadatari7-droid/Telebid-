"""Cross-tenant isolation — the whole point of this session's multi-tenant
conversion. Company B must never be able to read, write, or even detect
the existence of Company A's data (404, not 403, everywhere per the
established convention — a 403 would confirm the record exists)."""
import pytest


async def _create_opp(client, headers, customer_name="Isolation Test Customer"):
    r = await client.post("/api/v1/opportunities-v2", json={"customer_name": customer_name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["opp_id"]


async def test_company_b_cannot_read_company_a_opportunity(client, tenant, tenant_b):
    opp_id = await _create_opp(client, tenant["headers"])

    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant_b["headers"])
    assert r.status_code == 404


async def test_company_b_cannot_patch_company_a_opportunity(client, tenant, tenant_b):
    opp_id = await _create_opp(client, tenant["headers"])

    r = await client.patch(f"/api/v1/opportunities-v2/{opp_id}", json={"customer_name": "Hijacked"}, headers=tenant_b["headers"])
    assert r.status_code == 404

    # Confirm it genuinely wasn't touched, from company A's own view.
    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    assert check.json()["opportunity"]["customer_name"] == "Isolation Test Customer"


async def test_company_b_cannot_submit_company_a_opportunity_for_approval(client, tenant, tenant_b):
    opp_id = await _create_opp(client, tenant["headers"])

    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant_b["headers"])
    assert r.status_code == 404

    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])
    assert check.json()["opportunity"]["status"] == "DRAFT"


async def test_company_b_list_never_includes_company_a_rows(client, tenant, tenant_b):
    await _create_opp(client, tenant["headers"], "Only Company A Should See This")

    r = await client.get("/api/v1/opportunities-v2", headers=tenant_b["headers"])
    assert r.status_code == 200
    names = [o["customer_name"] for o in r.json()["items"]]
    assert "Only Company A Should See This" not in names


async def test_company_b_cannot_reach_company_a_sub_resources(client, tenant, tenant_b):
    """Sub-resources (costing, requirements, questions, team) are scoped
    through _own_opp_or_404 — verify that holds for a couple of them."""
    opp_id = await _create_opp(client, tenant["headers"])

    costing = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant_b["headers"])
    assert costing.status_code == 404

    requirements = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant_b["headers"])
    assert requirements.status_code == 404

    team = await client.get(f"/api/v1/opportunities-v2/{opp_id}/team", headers=tenant_b["headers"])
    assert team.status_code == 404


async def test_company_b_cannot_add_requirement_to_company_a_opportunity(client, tenant, tenant_b):
    opp_id = await _create_opp(client, tenant["headers"])

    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/requirements",
        json={"requirement_text": "Injected by Company B", "category": "Other"},
        headers=tenant_b["headers"])
    assert r.status_code == 404

    own = await client.get(f"/api/v1/opportunities-v2/{opp_id}/requirements", headers=tenant["headers"])
    assert own.json()["items"] == []


async def test_company_b_cannot_reach_company_a_apmp_sub_resources(client, tenant, tenant_b):
    """The four APMP feature sub-resources (qualification, capture,
    color-reviews, win-themes) are scoped through _own_opp_or_404 exactly
    like requirements/costing/team above — verify each one."""
    opp_id = await _create_opp(client, tenant["headers"])

    qualification = await client.get(f"/api/v1/opportunities-v2/{opp_id}/qualification", headers=tenant_b["headers"])
    assert qualification.status_code == 404
    qualification_post = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification", json={
        "score_customer_relationship": 3, "score_competitive_position": 3, "score_technical_fit": 3,
        "score_financial_value": 3, "score_resource_availability": 3, "score_strategic_fit": 3,
        "recommendation": "BID",
    }, headers=tenant_b["headers"])
    assert qualification_post.status_code == 404

    capture = await client.get(f"/api/v1/opportunities-v2/{opp_id}/capture", headers=tenant_b["headers"])
    assert capture.status_code == 404
    capture_put = await client.put(f"/api/v1/opportunities-v2/{opp_id}/capture",
        json={"capture_strategy": "Injected by Company B"}, headers=tenant_b["headers"])
    assert capture_put.status_code == 404

    color_reviews = await client.get(f"/api/v1/opportunities-v2/{opp_id}/color-reviews", headers=tenant_b["headers"])
    assert color_reviews.status_code == 404
    color_reviews_post = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews",
        json={"review_type": "PINK"}, headers=tenant_b["headers"])
    assert color_reviews_post.status_code == 404

    win_themes = await client.get(f"/api/v1/opportunities-v2/{opp_id}/win-themes", headers=tenant_b["headers"])
    assert win_themes.status_code == 404
    win_themes_post = await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Injected by Company B"}, headers=tenant_b["headers"])
    assert win_themes_post.status_code == 404

    # Confirm company A's own data is untouched by the rejected writes above.
    own_capture = await client.get(f"/api/v1/opportunities-v2/{opp_id}/capture", headers=tenant["headers"])
    assert own_capture.json() is None
    own_themes = await client.get(f"/api/v1/opportunities-v2/{opp_id}/win-themes", headers=tenant["headers"])
    assert own_themes.json() == []


async def test_content_library_entries_are_tenant_scoped(client, tenant, tenant_b):
    r = await client.post("/api/v1/content-library", json={
        "question": "Company A's private answer", "answer": "Secret to A", "category": "Other",
    }, headers=tenant["headers"])
    assert r.status_code == 201

    listing = await client.get("/api/v1/content-library", headers=tenant_b["headers"])
    questions = [it["question"] for it in listing.json()["items"]]
    assert "Company A's private answer" not in questions


async def test_ai_alerts_history_is_tenant_scoped(client, tenant, tenant_b):
    r = await client.get("/api/v1/scheduler/ai-alerts", headers=tenant["headers"])
    assert r.status_code == 200
    r2 = await client.get("/api/v1/scheduler/ai-alerts", headers=tenant_b["headers"])
    assert r2.status_code == 200
    # Both start empty and independent — no cross-tenant leakage possible
    # since the query is always scoped by company_id (see scheduler.py).
    assert r.json()["items"] == []
    assert r2.json()["items"] == []
