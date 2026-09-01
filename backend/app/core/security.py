from datetime import datetime, timedelta
from typing import Dict, Any
from jose import JWTError, jwt
import bcrypt
import pyotp
import secrets
from app.core.config import settings


def hash_password(password: str) -> str:
    """Hash a password using bcrypt directly (no passlib)."""
    pw_bytes = password.encode("utf-8")[:72]  # bcrypt max 72 bytes
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        pw_bytes = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise ValueError("Invalid or expired token")


def generate_otp_secret() -> str:
    return pyotp.random_base32()


def generate_totp(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def verify_totp(secret: str, token: str) -> bool:
    return pyotp.TOTP(secret).verify(token, valid_window=1)


def generate_invitation_code() -> str:
    return secrets.token_urlsafe(32)
