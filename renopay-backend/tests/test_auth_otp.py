"""
End-to-end tests for Email OTP authentication:
- Send success with mocked SMTP provider
- Verify success (creates new user + account, returns valid tokens)
- Existing user authentication without duplication
- Wrong code rejection
- Expired code rejection
- Max 5 attempts lockout
- Rate limits (3/hr per email AND per IP)
- Zero user enumeration
- OTP is never exposed in any API response
"""
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_access_token
from app.core.rate_limit import _memory_buckets
from app.models.user import User
from app.models.account import Account
from app.routers.auth import send_otp_endpoint, verify_otp_endpoint, _get_redis
from app.schemas.auth import SendOtpRequest, VerifyOtpRequest
from app.services.sms import SMSProvider, set_sms_provider

pytestmark = pytest.mark.asyncio


class MockEmailProvider(SMSProvider):
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_otp(self, recipient: str, otp: str) -> None:
        self.sent.append((recipient, otp))


@pytest.fixture(autouse=True)
async def setup_mock_sms_and_rate_limits():
    """Inject MockEmailProvider and clear in-memory rate limit / redis buckets between tests."""
    mock_provider = MockEmailProvider()
    set_sms_provider(mock_provider)
    _memory_buckets.clear()
    redis = await _get_redis()
    if hasattr(redis, "_data"):
        redis._data.clear()
    if hasattr(redis, "_expiry"):
        redis._expiry.clear()
    yield mock_provider
    set_sms_provider(None)


def make_request(ip: str = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/auth/otp/send",
        "headers": [(b"x-forwarded-for", ip.encode("utf-8"))],
        "client": (ip, 12345),
    }
    return Request(scope)


async def test_send_otp_success_and_otp_never_in_response(setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    req = make_request(ip="10.0.0.1")
    email = "testuser@example.com"

    response = await send_otp_endpoint(SendOtpRequest(email=email), request=req)

    # Email provider received the 6-digit code
    assert len(mock_provider.sent) == 1
    recipient, code = mock_provider.sent[0]
    assert recipient == email
    assert len(code) == settings.OTP_LENGTH
    assert code.isdigit()

    # Verify OTP is NEVER disclosed in API response
    response_dict = response.model_dump()
    assert "otp" not in response_dict
    assert "code" not in response_dict
    assert code not in str(response_dict)
    assert response.message == "If this email is valid, a verification code has been sent."


async def test_verify_otp_new_user_success_and_valid_tokens(db_session, setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    email = "newmember@example.com"

    await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="10.0.0.2"))
    _, code = mock_provider.sent[0]

    # Verify OTP
    token_resp = await verify_otp_endpoint(
        VerifyOtpRequest(email=email, otp=code),
        db=db_session,
    )

    # Tokens issued
    assert token_resp.access_token is not None
    assert token_resp.refresh_token is not None
    assert token_resp.user_id is not None

    # Validate access token cryptographic signature & user_id claim
    token_user_id = decode_access_token(token_resp.access_token)
    assert token_user_id == token_resp.user_id

    # Verify user created in DB
    u_res = await db_session.execute(select(User).where(User.id == token_resp.user_id))
    user = u_res.scalar_one_or_none()
    assert user is not None
    assert user.email == email
    assert user.phone_number is None  # email-first user without phone requirement

    # Verify default account created
    acc_res = await db_session.execute(select(Account).where(Account.user_id == user.id))
    account = acc_res.scalar_one_or_none()
    assert account is not None
    assert account.current_balance_paise == 5000000

    # Ensure OTP was deleted upon successful verification (replay prevention)
    with pytest.raises(HTTPException) as exc_info:
        await verify_otp_endpoint(
            VerifyOtpRequest(email=email, otp=code),
            db=db_session,
        )
    assert exc_info.value.status_code == 400


async def test_verify_otp_existing_user(db_session, setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    email = "existinguser@example.com"

    # Create existing user
    user = User(
        full_name="Existing User",
        email=email,
        phone_number="9988776655",
    )
    db_session.add(user)
    await db_session.flush()

    account = Account(
        user_id=user.id,
        virtual_acc_no="VPA1234567890",
        vpa="existinguser@renopay",
        current_balance_paise=1000000,
    )
    db_session.add(account)
    await db_session.commit()

    # Send and verify OTP
    await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="10.0.0.3"))
    _, code = mock_provider.sent[0]

    token_resp = await verify_otp_endpoint(
        VerifyOtpRequest(email=email, otp=code),
        db=db_session,
    )

    assert token_resp.user_id == user.id


async def test_verify_wrong_code(db_session, setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    email = "wrongcode@example.com"

    await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="10.0.0.4"))
    _, real_code = mock_provider.sent[0]

    wrong_code = "000000" if real_code != "000000" else "111111"

    with pytest.raises(HTTPException) as exc:
        await verify_otp_endpoint(
            VerifyOtpRequest(email=email, otp=wrong_code),
            db=db_session,
        )
    assert exc.value.status_code == 400
    assert "Invalid or expired" in exc.value.detail


async def test_verify_expired_code(db_session, setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    email = "expired@example.com"

    await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="10.0.0.5"))
    _, code = mock_provider.sent[0]

    # Expire/delete OTP in Redis
    redis = await _get_redis()
    await redis.delete(f"otp:{email}")

    with pytest.raises(HTTPException) as exc:
        await verify_otp_endpoint(
            VerifyOtpRequest(email=email, otp=code),
            db=db_session,
        )
    assert exc.value.status_code == 400
    assert "Invalid or expired" in exc.value.detail


async def test_max_attempts_lockout(db_session, setup_mock_sms_and_rate_limits):
    mock_provider = setup_mock_sms_and_rate_limits
    email = "lockout@example.com"

    await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="10.0.0.6"))
    _, real_code = mock_provider.sent[0]

    wrong_code = "999999" if real_code != "999999" else "888888"

    # Attempts 1 through 4 fail with 400
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        with pytest.raises(HTTPException) as exc:
            await verify_otp_endpoint(
                VerifyOtpRequest(email=email, otp=wrong_code),
                db=db_session,
            )
        assert exc.value.status_code == 400

    # 5th attempt triggers lockout (429)
    with pytest.raises(HTTPException) as exc_lockout:
        await verify_otp_endpoint(
            VerifyOtpRequest(email=email, otp=wrong_code),
            db=db_session,
        )
    assert exc_lockout.value.status_code == 429
    assert "Too many failed verification attempts" in exc_lockout.value.detail

    # Subsequent verification even with CORRECT code is now blocked
    with pytest.raises(HTTPException) as exc_blocked:
        await verify_otp_endpoint(
            VerifyOtpRequest(email=email, otp=real_code),
            db=db_session,
        )
    # OTP key was deleted, so code is no longer accepted
    assert exc_blocked.value.status_code in (400, 429)


async def test_rate_limits_dual_enforcement(setup_mock_sms_and_rate_limits):
    ip = "192.168.100.50"
    email = "ratelimited@example.com"

    # First 3 requests to this email from this IP succeed
    for _ in range(settings.OTP_SENDS_PER_HOUR):
        await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip=ip))

    # 4th request exceeds rate limit per email (429)
    with pytest.raises(HTTPException) as exc_email_limit:
        await send_otp_endpoint(SendOtpRequest(email=email), request=make_request(ip="192.168.100.99"))
    assert exc_email_limit.value.status_code == 429
    assert "Rate limit exceeded" in exc_email_limit.value.detail

    # 4th request from same IP with different email also exceeds IP rate limit (429)
    with pytest.raises(HTTPException) as exc_ip_limit:
        await send_otp_endpoint(SendOtpRequest(email="another@example.com"), request=make_request(ip=ip))
    assert exc_ip_limit.value.status_code == 429
    assert "Rate limit exceeded" in exc_ip_limit.value.detail

    # Request from different IP and different email succeeds
    resp = await send_otp_endpoint(SendOtpRequest(email="clean@example.com"), request=make_request(ip="192.168.200.1"))
    assert resp.message == "If this email is valid, a verification code has been sent."


async def test_no_user_enumeration(db_session, setup_mock_sms_and_rate_limits):
    existing_email = "existing_enum@example.com"
    unknown_email = "unknown_enum@example.com"

    # Create one user in DB
    user = User(full_name="Enumeration Target", email=existing_email)
    db_session.add(user)
    await db_session.commit()

    resp_existing = await send_otp_endpoint(
        SendOtpRequest(email=existing_email),
        request=make_request(ip="10.0.1.1"),
    )
    resp_unknown = await send_otp_endpoint(
        SendOtpRequest(email=unknown_email),
        request=make_request(ip="10.0.1.2"),
    )

    # Identical responses: zero information leakage
    assert resp_existing.model_dump() == resp_unknown.model_dump()
    assert resp_existing.message == resp_unknown.message
