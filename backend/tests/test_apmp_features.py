"""APMP Body of Knowledge features: formal bid/no-bid qualification, capture
management, color team reviews (Pink/Red/Gold), and win themes. All four are
per-opportunity sub-resources following the same conventions the compliance
matrix and approval chain already use (see test_compliance_and_library.py /
test_opportunities_lifecycle.py for the established patterns)."""
import pytest


async def _create_opp(client, headers):
    r = await client.post("/api/v1/opportunities-v2", json={"customer_name": "APMP Test Customer"}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["opp_id"]


_SCORES = {
    "score_customer_relationship": 4,
    "score_competitive_position": 3,
    "score_technical_fit": 5,
    "score_financial_value": 4,
    "score_resource_availability": 3,
    "score_strategic_fit": 2,
}


# ── Qualification ────────────────────────────────────────────────────────────

async def test_qualification_scoring_computes_weighted_total(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**_SCORES, "recommendation": "BID", "notes": "Strong technical fit"}, headers=tenant["headers"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["recommendation"] == "BID"
    # 4/5*.20 + 3/5*.20 + 5/5*.20 + 4/5*.15 + 3/5*.15 + 2/5*.10 = 0.16+0.12+0.20+0.12+0.09+0.04 = 0.73 -> 73.00
    assert float(body["weighted_total"]) == pytest.approx(73.0, abs=0.01)


async def test_qualification_history_keeps_every_scoring_event(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    first = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**_SCORES, "recommendation": "CONDITIONAL_BID"}, headers=tenant["headers"])
    assert first.status_code == 201

    second_scores = {**_SCORES, "score_strategic_fit": 5}
    second = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**second_scores, "recommendation": "BID"}, headers=tenant["headers"])
    assert second.status_code == 201

    listing = await client.get(f"/api/v1/opportunities-v2/{opp_id}/qualification", headers=tenant["headers"])
    assert listing.status_code == 200
    data = listing.json()
    assert len(data["history"]) == 2
    assert data["latest"]["recommendation"] == "BID"
    assert data["latest"]["qualification_id"] == second.json()["qualification_id"]


async def test_qualification_rejects_out_of_range_score(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    bad = {**_SCORES, "score_technical_fit": 7}
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**bad, "recommendation": "BID"}, headers=tenant["headers"])
    assert r.status_code == 422


async def test_qualification_rejects_invalid_recommendation(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**_SCORES, "recommendation": "MAYBE"}, headers=tenant["headers"])
    assert r.status_code == 422


async def test_no_bid_qualification_does_not_block_submit(client, tenant):
    """Deliberate scope boundary: qualification is advisory, like the AI
    advisor — it must never gate the real submit-for-approval flow."""
    opp_id = await _create_opp(client, tenant["headers"])
    q = await client.post(f"/api/v1/opportunities-v2/{opp_id}/qualification",
        json={**_SCORES, "recommendation": "NO_BID"}, headers=tenant["headers"])
    assert q.status_code == 201

    submit = await client.post(f"/api/v1/opportunities-v2/{opp_id}/submit", headers=tenant["headers"])
    assert submit.status_code == 200


# ── Capture Management ───────────────────────────────────────────────────────

async def test_capture_get_before_save_is_empty(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/capture", headers=tenant["headers"])
    assert r.status_code == 200
    assert r.json() is None


async def test_capture_upsert_updates_in_place(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    first = await client.put(f"/api/v1/opportunities-v2/{opp_id}/capture",
        json={"capture_strategy": "Initial approach", "relationship_strength": "WEAK"}, headers=tenant["headers"])
    assert first.status_code == 200, first.text
    assert first.json()["relationship_strength"] == "WEAK"

    second = await client.put(f"/api/v1/opportunities-v2/{opp_id}/capture",
        json={"capture_strategy": "Refined approach", "relationship_strength": "STRONG",
              "key_contacts": '[{"name":"Jane Doe","title":"CTO","notes":"champion"}]'},
        headers=tenant["headers"])
    assert second.status_code == 200
    assert second.json()["capture_strategy"] == "Refined approach"
    assert second.json()["relationship_strength"] == "STRONG"

    check = await client.get(f"/api/v1/opportunities-v2/{opp_id}/capture", headers=tenant["headers"])
    body = check.json()
    assert body["capture_strategy"] == "Refined approach"
    assert "Jane Doe" in body["key_contacts"]


# ── Color Team Reviews ───────────────────────────────────────────────────────

async def test_color_review_lifecycle_and_locking(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])

    create = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews",
        json={"review_type": "PINK", "reviewers": "alice@example.com"}, headers=tenant["headers"])
    assert create.status_code == 201, create.text
    review_id = create.json()["review_id"]
    assert create.json()["is_locked"] is False

    patch = await client.patch(f"/api/v1/opportunities-v2/{opp_id}/color-reviews/{review_id}",
        json={"reviewers": "alice@example.com, bob@example.com"}, headers=tenant["headers"])
    assert patch.status_code == 200

    complete = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews/{review_id}/complete",
        json={"rating": "PASS_WITH_COMMENTS", "strengths": "Clear win themes", "weaknesses": "Pricing risk"},
        headers=tenant["headers"])
    assert complete.status_code == 200, complete.text
    assert complete.json()["is_locked"] is True
    assert complete.json()["status"] == "COMPLETED"

    # Locked: further edits, re-completion, and delete must all be rejected.
    re_patch = await client.patch(f"/api/v1/opportunities-v2/{opp_id}/color-reviews/{review_id}",
        json={"reviewers": "changed"}, headers=tenant["headers"])
    assert re_patch.status_code == 400

    re_complete = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews/{review_id}/complete",
        json={"rating": "FAIL"}, headers=tenant["headers"])
    assert re_complete.status_code == 400

    delete = await client.delete(f"/api/v1/opportunities-v2/{opp_id}/color-reviews/{review_id}", headers=tenant["headers"])
    assert delete.status_code == 400


async def test_color_review_supports_multiple_instances_per_stage(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    pink = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews",
        json={"review_type": "PINK"}, headers=tenant["headers"])
    red = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews",
        json={"review_type": "RED"}, headers=tenant["headers"])
    assert pink.status_code == 201 and red.status_code == 201

    listing = await client.get(f"/api/v1/opportunities-v2/{opp_id}/color-reviews", headers=tenant["headers"])
    types = [r["review_type"] for r in listing.json()]
    assert sorted(types) == ["PINK", "RED"]


async def test_color_review_rejects_invalid_type(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    r = await client.post(f"/api/v1/opportunities-v2/{opp_id}/color-reviews",
        json={"review_type": "BLUE"}, headers=tenant["headers"])
    assert r.status_code == 422


# ── Win Themes ────────────────────────────────────────────────────────────────

async def test_win_theme_add_and_sort_order_autoincrements(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    first = await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Proven track record"}, headers=tenant["headers"])
    second = await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Local presence"}, headers=tenant["headers"])
    assert first.status_code == 201 and second.status_code == 201
    assert second.json()["sort_order"] > first.json()["sort_order"]


async def test_win_theme_reorder_via_sort_order_patch(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    a = (await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Theme A"}, headers=tenant["headers"])).json()
    b = (await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Theme B"}, headers=tenant["headers"])).json()

    # Swap sort_order so B now sorts first.
    await client.patch(f"/api/v1/opportunities-v2/{opp_id}/win-themes/{a['theme_id']}",
        json={"sort_order": b["sort_order"]}, headers=tenant["headers"])
    await client.patch(f"/api/v1/opportunities-v2/{opp_id}/win-themes/{b['theme_id']}",
        json={"sort_order": a["sort_order"]}, headers=tenant["headers"])

    listing = await client.get(f"/api/v1/opportunities-v2/{opp_id}/win-themes", headers=tenant["headers"])
    titles = [t["theme_title"] for t in listing.json()]
    assert titles == ["Theme B", "Theme A"]


async def test_win_theme_delete(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    created = await client.post(f"/api/v1/opportunities-v2/{opp_id}/win-themes",
        json={"theme_title": "Delete me"}, headers=tenant["headers"])
    theme_id = created.json()["theme_id"]

    delete = await client.delete(f"/api/v1/opportunities-v2/{opp_id}/win-themes/{theme_id}", headers=tenant["headers"])
    assert delete.status_code == 200
    again = await client.delete(f"/api/v1/opportunities-v2/{opp_id}/win-themes/{theme_id}", headers=tenant["headers"])
    assert again.status_code == 404
