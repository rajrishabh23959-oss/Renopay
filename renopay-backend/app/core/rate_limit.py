"""
Redis-backed rate limiter with graceful in-memory fallback.
Provides per-IP and per-user rate limiting for critical auth & payment endpoints.
"""
import time
from collections import defaultdict
from fastapi import Request, HTTPException, status
from app.core.config import settings
from app.core.logging import logger

# In-memory fallback if Redis is not connected
_memory_buckets: dict[str, list[float]] = defaultdict(list)
_redis_client = None


async def get_redis_client():
    global _redis_client
    if _redis_client is None and getattr(settings, "REDIS_URL", None):
        try:
            import redis.asyncio as aioredis
            _redis_client = aioredis.from_url(
                settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1.0
            )
            await _redis_client.ping()
        except Exception as e:
            logger.warning("Redis not available for rate limiter (%s); using in-memory fallback", e)
            _redis_client = None
    return _redis_client


async def check_rate_limit(key: str, max_requests: int, window_seconds: int):
    """
    Checks rate limit for a given key.
    Raises HTTPException(429) if exceeded.
    """
    redis = await get_redis_client()
    now = time.time()

    if redis:
        try:
            redis_key = f"renopay:ratelimit:{key}"
            pipe = redis.pipeline()
            # Remove timestamps outside window
            cutoff = now - window_seconds
            await pipe.zremrangebyscore(redis_key, 0, cutoff)
            await pipe.zadd(redis_key, {str(now): now})
            await pipe.zcard(redis_key)
            await pipe.expire(redis_key, window_seconds)
            results = await pipe.execute()
            count = results[2]

            if count > max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded ({max_requests} requests per {window_seconds}s). Please try again later.",
                )
            return
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Redis rate limit check error (%s), falling back to in-memory", e)

    # In-memory sliding window fallback
    cutoff = now - window_seconds
    timestamps = [t for t in _memory_buckets[key] if t > cutoff]
    if len(timestamps) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({max_requests} requests per {window_seconds}s). Please try again later.",
        )
    timestamps.append(now)
    _memory_buckets[key] = timestamps


def rate_limit_ip(max_requests: int, window_seconds: int = 60):
    """FastAPI dependency for IP-based rate limiting (e.g. login, register)."""
    async def dependency(request: Request):
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or request.client.host
            if request.client
            else "unknown"
        )
        endpoint = request.url.path
        key = f"ip:{client_ip}:{endpoint}"
        await check_rate_limit(key, max_requests, window_seconds)
    return dependency


def rate_limit_user(max_requests: int, window_seconds: int = 60):
    """FastAPI dependency for User-based rate limiting (e.g. payments)."""
    async def dependency(request: Request):
        # Extract user from request state if authenticated
        user = getattr(request.state, "user", None)
        user_id = str(user.id) if user else "anonymous"
        endpoint = request.url.path
        key = f"user:{user_id}:{endpoint}"
        await check_rate_limit(key, max_requests, window_seconds)
    return dependency
