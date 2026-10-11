import uuid
from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone_number: str = Field(min_length=10, max_length=15)
    email: str | None = None
    pan_number: str | None = None
    aadhaar_number: str | None = None  # raw input, encrypted before storage

    @field_validator("phone_number")
    @classmethod
    def digits_only(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("phone_number must contain digits only")
        return v


class SetPinRequest(BaseModel):
    pin: str = Field(min_length=6, max_length=6)
    confirm_pin: str = Field(min_length=6, max_length=6)

    @field_validator("confirm_pin")
    @classmethod
    def pins_match(cls, v, info):
        if "pin" in info.data and v != info.data["pin"]:
            raise ValueError("PINs do not match")
        return v


class LoginRequest(BaseModel):
    phone_number: str
    pin: str | None = Field(default=None, min_length=6, max_length=6)
    device_fingerprint: str | None = None
    device_label: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: uuid.UUID


class SendOtpRequest(BaseModel):
    email: str = Field(min_length=5, max_length=120)

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if "@" not in clean or "." not in clean.split("@")[-1]:
            raise ValueError("Invalid email format")
        return clean


class SendOtpResponse(BaseModel):
    message: str = "If this email is valid, a verification code has been sent."


class VerifyOtpRequest(BaseModel):
    email: str = Field(min_length=5, max_length=120)
    otp: str = Field(min_length=6, max_length=6)
    device_fingerprint: str | None = None
    device_label: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if "@" not in clean or "." not in clean.split("@")[-1]:
            raise ValueError("Invalid email format")
        return clean

    @field_validator("otp")
    @classmethod
    def digits_only(cls, v: str) -> str:
        clean = v.strip()
        if not clean.isdigit():
            raise ValueError("OTP must contain digits only")
        return clean


class VerifyPinRequest(BaseModel):
    pin: str


