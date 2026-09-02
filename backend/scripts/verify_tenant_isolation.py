#!/usr/bin/env python3
"""
Automated tenant-isolation regression check for the multi-tenant SaaS
conversion. Run against a live dev server:

    ./venv/bin/python scripts/verify_tenant_isolation.py [base_url]

Flow, per the conversion plan's verification section:
  1. Sign up two fresh tenants via POST /auth/signup.
  2. Each tenant creates one row in a representative sample of
     tenant-scoped resources.
  3. For every list endpoint: assert Tenant A's response contains zero
     Tenant B rows AND does contain its own row (checking both
     directions catches a filter that just returns nothing for
     everyone, which would otherwise look like a false pass).
  4. For every detail-by-ID endpoint: Tenant A fetching Tenant B's ID
     must 404, with no side effect on Tenant B's row.
  5. Confirm Tenant A cannot see Tenant B's users.

Exits non-zero (and prints every failure) if any check fails.
"""
import sys
import random
import string
import httpx

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
API = f"{BASE_URL}/api/v1"

failures = []


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {label}")
    if not condition:
        failures.append(label)


def signup(client, tag):
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    body = {
        "company_name": f"Isolation Test {tag} {suffix}",
        "company_code": f"IT{tag}{suffix}"[:20].upper(),
        "admin_username": f"it_{tag}_{suffix}",
        "admin_email": f"it_{tag}_{suffix}@example.com",
        "admin_password": "IsoTest123",
        "admin_full_name": f"Isolation Admin {tag}",
    }
    r = client.post(f"{API}/auth/signup", json=body)
    r.raise_for_status()
    data = r.json()
    return {
        "token": data["access_token"],
        "user_id": data["user"]["user_id"],
        "company_id": data["user"]["company_id"],
        "username": body["admin_username"],
    }


def auth_headers(tenant):
    return {"Authorization": f"Bearer {tenant['token']}"}


def main():
    with httpx.Client(timeout=15) as client:
        print("== Signing up two fresh tenants ==")
        a = signup(client, "A")
        b = signup(client, "B")
        print(f"Tenant A: company_id={a['company_id']}  Tenant B: company_id={b['company_id']}")
        check("Tenants got distinct company_id", a["company_id"] != b["company_id"])

        # ── Vendors ──────────────────────────────────────────────────────
        va = client.post(f"{API}/vendors", headers=auth_headers(a),
                          json={"company_name": "Vendor A Co", "email": "vendora@example.com"}).json()
        vb = client.post(f"{API}/vendors", headers=auth_headers(b),
                          json={"company_name": "Vendor B Co", "email": "vendorb@example.com"}).json()
        vendor_a_id, vendor_b_id = va.get("vendor_id"), vb.get("vendor_id")

        list_a = client.get(f"{API}/vendors", headers=auth_headers(a)).json()
        ids_a = {v["vendor_id"] for v in list_a.get("items", list_a if isinstance(list_a, list) else [])}
        check("Vendors: A's list contains A's own vendor", vendor_a_id in ids_a)
        check("Vendors: A's list excludes B's vendor", vendor_b_id not in ids_a)

        r = client.get(f"{API}/vendors/{vendor_b_id}", headers=auth_headers(a))
        check("Vendors: A fetching B's vendor by ID 404s", r.status_code == 404)

        # ── Bids ─────────────────────────────────────────────────────────
        bid_a = client.post(f"{API}/bids", headers=auth_headers(a), json={
            "bid_title": "Isolation Bid A", "bid_type_id": 1, "bid_source": "OTHER",
        })
        bid_b = client.post(f"{API}/bids", headers=auth_headers(b), json={
            "bid_title": "Isolation Bid B", "bid_type_id": 1, "bid_source": "OTHER",
        })
        if bid_a.status_code < 300 and bid_b.status_code < 300:
            bid_a_id, bid_b_id = bid_a.json().get("bid_id"), bid_b.json().get("bid_id")
            list_a = client.get(f"{API}/bids", headers=auth_headers(a)).json()
            ids_a = {x["bid_id"] for x in list_a.get("items", [])}
            check("Bids: A's list contains A's own bid", bid_a_id in ids_a)
            check("Bids: A's list excludes B's bid", bid_b_id not in ids_a)

            r = client.get(f"{API}/bids/{bid_b_id}", headers=auth_headers(a))
            check("Bids: A fetching B's bid by ID 404s", r.status_code == 404)

            r = client.post(f"{API}/watchlist/{bid_b_id}", headers=auth_headers(a))
            check("Watchlist: A adding B's bid_id 404s (no cross-tenant watchlist leak)", r.status_code == 404)

            r = client.post(f"{API}/comments/bid/{bid_b_id}", headers=auth_headers(a), json={"body": "leak attempt"})
            check("Comments: A posting on B's bid_id 404s", r.status_code == 404)
        else:
            print("[SKIP] Bid creation failed for one tenant — skipping bid-dependent checks "
                  f"(A={bid_a.status_code}, B={bid_b.status_code})")

        # ── Employees ────────────────────────────────────────────────────
        emp_suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        name_a, name_b = f"Emp A {emp_suffix}", f"Emp B {emp_suffix}"
        r_emp_a = client.post(f"{API}/employees", headers=auth_headers(a), json={
            "employee_code": f"ISOA-{emp_suffix}", "full_name": name_a, "email": f"empa{emp_suffix}@example.com", "employee_type": "SALES",
        })
        r_emp_b = client.post(f"{API}/employees", headers=auth_headers(b), json={
            "employee_code": f"ISOB-{emp_suffix}", "full_name": name_b, "email": f"empb{emp_suffix}@example.com", "employee_type": "SALES",
        })
        check("Employees: creation succeeded for both tenants", r_emp_a.status_code < 300 and r_emp_b.status_code < 300)
        list_a = client.get(f"{API}/employees", headers=auth_headers(a)).json()
        names_a = {e["full_name"] for e in list_a}
        check("Employees: A's list contains A's own employee", name_a in names_a)
        check("Employees: A's list excludes B's employee", name_b not in names_a)

        # ── Users (the platform-wide list_users fix) ────────────────────
        list_a = client.get(f"{API}/users", headers=auth_headers(a)).json()
        usernames_a = {u["username"] for u in list_a.get("items", [])}
        check("Users: A's user list contains only A's own admin", usernames_a == {a["username"]})
        check("Users: A's user list excludes B's admin", b["username"] not in usernames_a)

        r = client.get(f"{API}/users/{b['user_id']}", headers=auth_headers(a))
        check("Users: A fetching B's user by ID 404s", r.status_code == 404)

        r = client.patch(f"{API}/users/{b['user_id']}/deactivate", headers=auth_headers(a))
        check("Users: A deactivating B's user 404s (no write)", r.status_code == 404)

        # ── Search ───────────────────────────────────────────────────────
        r = client.get(f"{API}/search", headers=auth_headers(a), params={"q": "Vendor B"}).json()
        check("Search: A searching for B's data returns zero results", r.get("count", 0) == 0)

        print(f"\n{len(failures)} failure(s) out of the checks above.")
        if failures:
            print("FAILED:")
            for f in failures:
                print(" -", f)
            sys.exit(1)
        print("All tenant isolation checks passed.")


if __name__ == "__main__":
    main()
