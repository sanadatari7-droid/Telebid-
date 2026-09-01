from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val
from app.middleware.auth import get_current_user, require_roles, CurrentUser

router = APIRouter(prefix="/service-categories", tags=["Service Categories"])

class CategoryCreate(BaseModel):
    service_type: str       # TELECOM or ICT
    parent_id: Optional[int] = None
    cat_name: str
    cat_name_ar: Optional[str] = None
    sort_order: int = 0

@router.get("")
async def list_categories(
    service_type: Optional[str]=None,
    parent_id: Optional[int]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    conds = ["is_active=TRUE"]
    args = []
    if service_type:
        args.append(service_type); conds.append(f"service_type=${len(args)}")
    if parent_id is not None:
        if parent_id == 0:
            conds.append("parent_id IS NULL")
        else:
            args.append(parent_id); conds.append(f"parent_id=${len(args)}")
    where = " AND ".join(conds)
    return await fetch_all(conn, f"SELECT * FROM service_categories WHERE {where} ORDER BY sort_order, cat_name")

@router.get("/tree")
async def get_tree(service_type: str, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Return full hierarchy tree for a service type."""
    roots = await fetch_all(conn,
        "SELECT * FROM service_categories WHERE service_type=$1 AND parent_id IS NULL AND is_active=TRUE ORDER BY sort_order",
        service_type)
    async def get_children(parent_id):
        children = await fetch_all(conn,
            "SELECT * FROM service_categories WHERE parent_id=$1 AND is_active=TRUE ORDER BY sort_order",
            parent_id)
        result = []
        for c in children:
            c = dict(c)
            c["children"] = await get_children(c["cat_id"])
            result.append(c)
        return result
    tree = []
    for root in roots:
        root = dict(root)
        root["children"] = await get_children(root["cat_id"])
        tree.append(root)
    return tree

@router.post("", status_code=201)
async def create_category(body: CategoryCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    parent_level = 0
    if body.parent_id:
        parent = await fetch_one(conn, "SELECT level FROM service_categories WHERE cat_id=$1", body.parent_id)
        if parent: parent_level = parent["level"]
    await execute(conn,
        "INSERT INTO service_categories (service_type, parent_id, cat_name, cat_name_ar, level, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
        body.service_type, body.parent_id, body.cat_name, body.cat_name_ar, parent_level+1, body.sort_order)
    return {"message": "Category created"}

@router.delete("/{cat_id}")
async def delete_category(cat_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    await execute(conn, "UPDATE service_categories SET is_active=FALSE WHERE cat_id=$1 OR parent_id=$1", cat_id)
    return {"message": "Deactivated"}
