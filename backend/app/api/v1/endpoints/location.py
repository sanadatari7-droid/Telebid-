from fastapi import APIRouter, Depends, HTTPException
from app.db.postgres import get_db, execute, fetch_one, fetch_val, require_company
from app.middleware.auth import get_current_user
from pydantic import BaseModel
from typing import Optional
import httpx

router = APIRouter(prefix="/location", tags=["Location"])

class LocationUpdate(BaseModel):
    bid_id: int
    location_name: Optional[str] = None
    location_address: Optional[str] = None
    location_city: Optional[str] = None
    location_country: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    location_source: str = "MANUAL"
    location_confidence: Optional[float] = None

class LocationSearch(BaseModel):
    query: str
    api_key: Optional[str] = None

@router.post("/geocode")
async def geocode(body: LocationSearch, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    """Use Google Maps Geocoding API to get coordinates for a location query."""
    # Get API key from settings if not provided
    if not body.api_key:
        company_id = require_company(current_user)
        setting = await fetch_one(conn,
            "SELECT setting_value FROM system_settings WHERE setting_key='google_maps_key' AND company_id=$1", company_id)
        api_key = setting["setting_value"] if setting else ""
    else:
        api_key = body.api_key

    if not api_key:
        # Fallback: return structure but note manual entry needed
        return {
            "success": False,
            "message": "Google Maps API key not configured. Please set it in Settings → Integrations or enter coordinates manually.",
            "manual_entry_required": True,
            "query": body.query
        }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"address": body.query, "key": api_key}
            )
            data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                r = data["results"][0]
                components = {c["types"][0]: c["long_name"] for c in r.get("address_components",[])}
                return {
                    "success": True,
                    "location_name": r.get("formatted_address",""),
                    "location_address": r.get("formatted_address",""),
                    "location_city": components.get("locality") or components.get("administrative_area_level_1",""),
                    "location_country": components.get("country",""),
                    "location_lat": r["geometry"]["location"]["lat"],
                    "location_lng": r["geometry"]["location"]["lng"],
                    "location_source": "GOOGLE_MAPS",
                    "location_confidence": 0.95,
                    "all_results": [{"address": res["formatted_address"]} for res in data["results"][:3]]
                }
            return {
                "success": False,
                "message": f"Location not found: {data.get('status','UNKNOWN')}. Please enter coordinates manually.",
                "manual_entry_required": True
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"Location service unavailable: {str(e)}. Please enter coordinates manually.",
            "manual_entry_required": True
        }

@router.post("/save")
async def save_location(body: LocationUpdate, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    """Save location info to a bid."""
    company_id = require_company(current_user)
    result = await execute(conn,
        """UPDATE bids SET
               location_name=$1, location_address=$2, location_city=$3,
               location_country=$4, location_lat=$5, location_lng=$6,
               location_source=$7, location_confidence=$8, updated_at=NOW()
           WHERE bid_id=$9 AND company_id=$10""",
        body.location_name, body.location_address, body.location_city,
        body.location_country, body.location_lat, body.location_lng,
        body.location_source, body.location_confidence, body.bid_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bid not found")
    return {"message": "Location saved"}
