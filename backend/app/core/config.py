from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://telebid:telebid123@localhost:5432/telebid"
    JWT_SECRET_KEY: str = "change-me-in-production-min-32-chars!!"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    OTP_ISSUER: str = "TeleBidEnterprise"
    OTP_EXPIRE_MINUTES: int = 5
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "TeleBid Enterprise <noreply@telebid.com>"
    SMTP_TLS: bool = True
    APP_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:5173"
    MAX_FILE_SIZE_MB: int = 25
    MAX_FAILED_LOGINS: int = 5
    BCRYPT_ROUNDS: int = 12
    CORS_ORIGINS: List[str] = ["http://localhost:5173","http://127.0.0.1:5173","http://localhost:3000","http://127.0.0.1:3000","https://*.vercel.app","https://*.railway.app"]
    # Optional: enables the AI Bid/No-Bid Advisor (app/services/ai_advisor.py).
    # Leave blank to run without it — the endpoints degrade to a clear
    # "not configured" response instead of failing.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-opus-5"

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
