"""
Central configuration. Everything secret or environment-specific lives here,
loaded from a .env file — never hardcoded in code.
"""
from pydantic import field_validator, ValidationInfo
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- App ---
    APP_NAME: str = "RenoPay"
    ENV: str = "development"  # development | staging | production
    DEBUG: bool = False

    # --- Database (Neon PostgreSQL) ---
    DATABASE_URL: str = "postgresql+asyncpg://renopay:renopay@localhost:5432/renopay"
    SYNC_DATABASE_URL: str = ""

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        from urllib.parse import urlsplit, parse_qs, urlencode, urlunsplit
        url = self.DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]

        try:
            parts = urlsplit(url)
            query_params = parse_qs(parts.query)

            # Map sslmode -> ssl for asyncpg
            if "sslmode" in query_params:
                mode = query_params.pop("sslmode")[0]
                if mode in ("require", "verify-ca", "verify-full", "prefer"):
                    query_params["ssl"] = ["require"]
            elif "ssl" not in query_params and "neon.tech" in parts.netloc:
                query_params["ssl"] = ["require"]

            # Remove parameters that asyncpg.connect does NOT accept (e.g. channel_binding from Neon)
            unsupported = ["channel_binding", "endpoint", "gssencmode", "sslrootcert", "sslcert", "sslkey"]
            for key in unsupported:
                query_params.pop(key, None)

            flat_query = []
            for k, v_list in query_params.items():
                for v in v_list:
                    flat_query.append((k, v))

            new_query = urlencode(flat_query)
            return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
        except Exception:
            return url

    @property
    def RESOLVED_SYNC_DATABASE_URL(self) -> str:
        url = self.SYNC_DATABASE_URL or self.DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql+psycopg2://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        elif url.startswith("postgresql+asyncpg://"):
            url = "postgresql+psycopg2://" + url[len("postgresql+asyncpg://"):]
        return url

    # --- Redis (OTP cache, rate limiting, PIN attempt lockout) ---
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- Auth / JWT ---
    JWT_SECRET_KEY: str = "CHANGE_ME_IN_ENV"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- PIN / OTP security ---
    OTP_EXPIRE_SECONDS: int = 300
    MAX_PIN_ATTEMPTS: int = 5
    PIN_LOCKOUT_MINUTES: int = 15

    # --- SMS delivery for OTPs ---
    # "console" (default) logs the OTP server-side instead of sending a
    # real SMS — safe for local dev/demos. Set to "twilio" for real
    # delivery once TWILIO_* credentials below are filled in.
    SMS_PROVIDER: str = "console"
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # --- Encryption for sensitive fields (Aadhaar ref, etc.) ---
    FIELD_ENCRYPTION_KEY: str = "CHANGE_ME_32_BYTE_FERNET_KEY_HERE=="

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret(cls, v: str, info: ValidationInfo):
        env = str(info.data.get("ENV", "development")).lower().strip()
        if env not in ("development", "test", "testing"):
            if v in ("CHANGE_ME_IN_ENV", "secret", "changeme") or len(v) < 32:
                raise ValueError("JWT_SECRET_KEY must be a strong secret (>= 32 chars) in non-development environments")
        return v

    @field_validator("FIELD_ENCRYPTION_KEY")
    @classmethod
    def validate_fernet_key(cls, v: str, info: ValidationInfo):
        env = str(info.data.get("ENV", "development")).lower().strip()
        if env not in ("development", "test", "testing"):
            if v.startswith("CHANGE_ME") or len(v) != 44:
                raise ValueError("FIELD_ENCRYPTION_KEY must be a valid 44-character urlsafe base64 Fernet key outside development environments")
        return v

    @field_validator("CORS_ORIGINS")
    @classmethod
    def validate_cors_origins(cls, v):
        default_origins = [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://10.0.2.2:8000",
            "http://10.0.2.2:5173",
            "https://renopay-u72j.vercel.app",
            "https://localhost",
            "http://localhost",
            "capacitor://localhost",
            "ionic://localhost",
        ]
        if isinstance(v, str):
            v_stripped = v.strip()
            if not v_stripped:
                return default_origins
            if v_stripped.startswith("[") and v_stripped.endswith("]"):
                try:
                    import json
                    parsed = json.loads(v_stripped)
                    if isinstance(parsed, list):
                        return parsed
                except Exception:
                    pass
            origins = [x.strip() for x in v.split(",") if x.strip()]
            return origins or default_origins
        return v

    # --- Business rules (mirrors the mock's constants) ---
    UPI_LITE_MAX_BALANCE_PAISE: int = 200_000       # ₹2,000
    UPI_LITE_MAX_TXN_PAISE: int = 50_000             # ₹500
    FINGERPRINT_MAX_TXN_PAISE: int = 200_000         # ₹2,000 — below this, skip PIN
    HIGH_VALUE_TXN_PAISE: int = 200_000              # ₹2,000 — triggers SentinAI heavier checks
    PRIVACY_CODE_THRESHOLD_PAISE: int = 200_000

    # --- CORS ---
    CORS_ORIGINS: list[str] | str = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://10.0.2.2:8000",
        "http://10.0.2.2:5173",
        "https://renopay-u72j.vercel.app",
        "https://localhost",
        "http://localhost",
        "capacitor://localhost",
        "ionic://localhost",
    ]

    # --- AI Assistant (Saathi) ---
    GROQ_API_KEY: str = ""
    DEFAULT_AI_MODEL: str = "openai/gpt-oss-120b"
    AI_HOURLY_RATE_LIMIT: int = 100

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
