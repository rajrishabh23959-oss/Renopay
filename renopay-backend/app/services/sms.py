"""
SMS delivery abstraction for OTPs. Swapping providers is a one-line
change in `get_sms_provider()` — nothing in app/routers/auth.py needs
to know which provider is active.

Two providers ship here:
- ConsoleSMSProvider: logs the OTP instead of sending it. This is what
  runs by default (SMS_PROVIDER=console) so the app works out of the
  box without any SMS account — exactly what auth.py's `debug_otp`
  response field was standing in for before this abstraction existed.
- TwilioSMSProvider: real implementation using the Twilio SDK. Needs
  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER set, and
  the `twilio` package installed (not in requirements.txt by default,
  since most local/demo setups won't need it — add it when you flip
  SMS_PROVIDER=twilio for a real deployment).
"""
import asyncio
import logging
from abc import ABC, abstractmethod

from app.core.config import settings

logger = logging.getLogger("renopay.sms")


class SMSProvider(ABC):
    @abstractmethod
    async def send_otp(self, recipient: str, otp: str) -> None:
        ...


class ConsoleSMSProvider(SMSProvider):
    """Default provider. Logs the OTP server-side only in development environment."""
    async def send_otp(self, recipient: str, otp: str) -> None:
        if settings.ENV == "development":
            logger.info("[DEV] Verification code for %s: %s", recipient, otp)
        else:
            logger.info("[DEV] Verification code dispatched to %s", recipient)


class EmailOTPProvider(SMSProvider):
    """
    Transactional email OTP provider using aiosmtplib with STARTTLS and timeout 10s.
    Delivers multipart (text + branded HTML) verification messages.
    """
    async def send_otp(self, recipient: str, otp: str) -> None:
        if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
            logger.error("SMTP_USER or SMTP_PASSWORD is not configured in settings")
            raise RuntimeError("Email delivery is not properly configured on this server.")

        from email.message import EmailMessage
        import aiosmtplib

        message = EmailMessage()
        from_display = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
        message["From"] = from_display
        message["To"] = recipient.strip()
        message["Subject"] = "Your RenoPay verification code"

        expire_mins = max(1, settings.OTP_EXPIRE_SECONDS // 60)
        plain_text = (
            f"Your RenoPay verification code is: {otp}\n\n"
            f"This code will expire in {expire_mins} minutes.\n"
            f"For your security, never share this code with anyone.\n\n"
            f"— Team RenoPay"
        )
        message.set_content(plain_text)

        html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your RenoPay verification code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0A0908; color: #F5F3F0; margin: 0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #151210; border: 1px solid #2A2320; border-radius: 20px; padding: 32px; text-align: center;">
    <div style="display: inline-block; width: 48px; height: 48px; border-radius: 50%; background-color: rgba(255, 106, 26, 0.2); border: 2px solid rgba(255, 106, 26, 0.4); line-height: 48px; font-size: 24px; margin-bottom: 16px;">
      ⚡
    </div>
    <h1 style="font-size: 22px; font-weight: 800; color: #F5F3F0; margin: 0 0 8px 0;">Reno<span style="color: #FF6A1A;">Pay</span></h1>
    <p style="font-size: 14px; color: #9A938C; margin: 0 0 24px 0;">Secure Email Login Verification</p>
    
    <div style="background-color: #1B1715; border: 1.5px dashed #FF6A1A; border-radius: 14px; padding: 18px 24px; margin-bottom: 24px;">
      <span style="font-family: 'Space Mono', monospace, Courier; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #FF6A1A;">{otp}</span>
    </div>

    <p style="font-size: 13px; color: #9A938C; line-height: 1.5; margin: 0 0 16px 0;">
      This verification code is valid for <strong>{expire_mins} minutes</strong>. Never share this code with anyone, including RenoPay staff.
    </p>
    <div style="border-top: 1px solid #2A2320; padding-top: 16px; font-size: 11px; color: #5C564F;">
      If you did not request this login code, you can safely disregard this email.
    </div>
  </div>
</body>
</html>"""
        message.add_alternative(html_content, subtype="html")

        try:
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                start_tls=True,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASSWORD,
                timeout=10.0,
            )
        except Exception as exc:
            # Clean error without leaking credentials
            logger.error("Failed to deliver OTP email: %s", type(exc).__name__)
            raise RuntimeError("Failed to deliver verification code email. Please check your SMTP settings or try again later.") from None


class TwilioSMSProvider(SMSProvider):
    def __init__(self):
        from twilio.rest import Client
        self._client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

    async def send_otp(self, recipient: str, otp: str) -> None:
        await asyncio.to_thread(
            self._client.messages.create,
            body=f"Your RenoPay verification code is {otp}. Valid for {settings.OTP_EXPIRE_SECONDS // 60} minutes.",
            from_=settings.TWILIO_FROM_NUMBER,
            to=f"+91{recipient}" if not recipient.startswith("+") else recipient,
        )


_provider_instance: SMSProvider | None = None


def get_sms_provider() -> SMSProvider:
    global _provider_instance
    if _provider_instance is None:
        if settings.SMS_PROVIDER == "email":
            _provider_instance = EmailOTPProvider()
        elif settings.SMS_PROVIDER == "twilio":
            _provider_instance = TwilioSMSProvider()
        else:
            _provider_instance = ConsoleSMSProvider()
    return _provider_instance


def set_sms_provider(provider: SMSProvider | None) -> None:
    """Allow injecting or resetting a provider (e.g. for testing)."""
    global _provider_instance
    _provider_instance = provider
