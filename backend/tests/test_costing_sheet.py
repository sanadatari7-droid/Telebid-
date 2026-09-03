"""Telecom costing sheet — the computed formula chain must match the
uploaded Excel template exactly: Selling = ROUNDUP(PriceList*(1-Disc%),0),
Total = Selling*Qty, Total_for_duration = Total_MRC*months + Total_NRC,
VAT = that*vat_pct/100, Grand Total = that + VAT. Values are computed at
read time, never stored — this test proves the math, not just that fields
exist."""
import math
import pytest


async def _create_opp(client, headers):
    r = await client.post("/api/v1/opportunities-v2", json={"customer_name": "Costing Test Customer"}, headers=headers)
    assert r.status_code == 201
    return r.json()["opp_id"]


async def test_costing_sheet_lazy_created_with_opp_number(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    opp = (await client.get(f"/api/v1/opportunities-v2/{opp_id}", headers=tenant["headers"])).json()["opportunity"]

    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant["headers"])
    assert r.status_code == 200
    sheet = r.json()["sheet"]
    assert sheet["order_number"] == opp["opp_number"]
    assert sheet["duration_months"] == 12
    assert float(sheet["vat_pct"]) == 15.00


async def test_line_selling_price_uses_roundup_not_bankers_rounding(client, tenant):
    """A discount that lands on exactly .5 must round UP (ROUNDUP), not to
    even (Python's default round() would round 100.5 -> 100, which is wrong
    here — math.ceil is required for Excel-compatible ROUNDUP behavior)."""
    opp_id = await _create_opp(client, tenant["headers"])

    add = await client.post(f"/api/v1/opportunities-v2/{opp_id}/costing/lines", json={
        "service_name": "Fiber 100Mbps", "qty": 3,
        "price_list_mrc": 201, "discount_mrc_pct": 0.5,   # 201*(1-0.5) = 100.5 -> ROUNDUP -> 101
        "price_list_nrc": 500, "discount_nrc_pct": 0,
    }, headers=tenant["headers"])
    assert add.status_code == 201, add.text

    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant["headers"])
    line = r.json()["lines"][0]
    assert line["selling_price_mrc"] == 101          # math.ceil(100.5) == 101
    assert line["selling_price_nrc"] == 500           # no discount
    assert line["total_mrc"] == 101 * 3
    assert line["total_nrc"] == 500 * 3


async def test_summary_totals_match_hand_calculation(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])

    await client.patch(f"/api/v1/opportunities-v2/{opp_id}/costing",
        json={"duration_months": 6, "vat_pct": 15}, headers=tenant["headers"])

    # Line 1: selling MRC = ceil(1000*(1-0.10)) = 900, qty 2 -> total_mrc 1800
    #          selling NRC = ceil(2000*(1-0)) = 2000, qty 2 -> total_nrc 4000
    await client.post(f"/api/v1/opportunities-v2/{opp_id}/costing/lines", json={
        "service_name": "MPLS Link", "qty": 2,
        "price_list_mrc": 1000, "discount_mrc_pct": 0.10,
        "price_list_nrc": 2000, "discount_nrc_pct": 0,
    }, headers=tenant["headers"])
    # Line 2: selling MRC = ceil(500*(1-0)) = 500, qty 1 -> total_mrc 500
    #          selling NRC = ceil(0) = 0
    await client.post(f"/api/v1/opportunities-v2/{opp_id}/costing/lines", json={
        "service_name": "Router", "qty": 1,
        "price_list_mrc": 500, "discount_mrc_pct": 0,
        "price_list_nrc": 0, "discount_nrc_pct": 0,
    }, headers=tenant["headers"])

    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant["headers"])
    summary = r.json()["summary"]

    subtotal_mrc = 1800 + 500          # 2300
    subtotal_nrc = 4000 + 0            # 4000
    total_for_duration = subtotal_mrc * 6 + subtotal_nrc   # 2300*6 + 4000 = 17800
    vat_amount = total_for_duration * 15 / 100             # 2670.0
    grand_total = total_for_duration + vat_amount          # 20470.0

    assert float(summary["subtotal_mrc"]) == subtotal_mrc
    assert float(summary["subtotal_nrc"]) == subtotal_nrc
    assert float(summary["total_for_duration"]) == total_for_duration
    assert float(summary["vat_amount"]) == vat_amount
    assert float(summary["grand_total"]) == grand_total


async def test_deleting_a_line_removes_it_from_summary(client, tenant):
    opp_id = await _create_opp(client, tenant["headers"])
    add = await client.post(f"/api/v1/opportunities-v2/{opp_id}/costing/lines", json={
        "service_name": "Temp Line", "qty": 1, "price_list_mrc": 100, "price_list_nrc": 0,
    }, headers=tenant["headers"])
    assert add.status_code == 201, add.text

    before = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant["headers"])
    line_id = before.json()["lines"][0]["line_id"]

    delete = await client.delete(f"/api/v1/opportunities-v2/{opp_id}/costing/lines/{line_id}", headers=tenant["headers"])
    assert delete.status_code == 200

    r = await client.get(f"/api/v1/opportunities-v2/{opp_id}/costing", headers=tenant["headers"])
    assert r.json()["lines"] == []
    assert float(r.json()["summary"]["grand_total"]) == 0
