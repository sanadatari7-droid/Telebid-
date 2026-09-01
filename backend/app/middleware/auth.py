from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List
from app.core.security import decode_token
from app.db.postgres import get_db, fetch_one, fetch_val

security = HTTPBearer()

class CurrentUser:
    def __init__(self, user_id:int, username:str, email:str, roles:List[str], full_name:str,
                 company_id:int=None, is_platform_admin:bool=False):
        self.user_id=user_id; self.username=username; self.email=email
        self.roles=roles; self.full_name=full_name
        self.company_id=company_id; self.is_platform_admin=is_platform_admin

    def has_role(self, *roles:str)->bool:
        return any(r in self.roles for r in roles)

    def require_role(self, *roles:str):
        if not self.has_role(*roles):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

async def get_current_user(credentials:HTTPAuthorizationCredentials=Depends(security), conn=Depends(get_db)) -> CurrentUser:
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await fetch_one(conn,
        "SELECT user_id,username,email,full_name,is_active,is_locked,company_id,is_platform_admin FROM users WHERE user_id=$1", int(user_id))
    if not user: raise HTTPException(status_code=401, detail="User not found")
    if not user["is_active"]: raise HTTPException(status_code=403, detail="Account inactive")
    if user["is_locked"]: raise HTTPException(status_code=403, detail="Account locked")
    # company_id is re-derived from the DB on every request, never trusted from
    # the JWT claim alone — this way a user moved/removed from a company loses
    # access immediately rather than at token expiry.
    if not user["company_id"]:
        raise HTTPException(status_code=403, detail="Account is not associated with a company")
    roles_str = await fetch_val(conn,
        "SELECT STRING_AGG(r.role_code,',') FROM user_roles ur JOIN roles r ON ur.role_id=r.role_id WHERE ur.user_id=$1",
        int(user_id))
    roles = roles_str.split(",") if roles_str else []
    return CurrentUser(user["user_id"],user["username"],user["email"],roles,user["full_name"],
                        user["company_id"],user["is_platform_admin"])

def require_roles(*roles:str):
    async def checker(current_user:CurrentUser=Depends(get_current_user)):
        current_user.require_role(*roles); return current_user
    return checker
