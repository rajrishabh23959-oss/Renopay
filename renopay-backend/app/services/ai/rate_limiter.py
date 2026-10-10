"""
Redis-backed rate limiter with in-memory fallback for Groq API platform quota.
Limits requests per user (e.g. 100 queries/hour) to protect platform quota.
BYO API key users bypass this limiter entirely.
"""
import time
from collections import defaultdict
from fastapi import HTTPException, status
import redis

from app.core.config import settings
from app.core.logging import logger

_sync_redis = None
_memory_timestamps: dict[str, list[float]] = defaultdict(list)
WINDOW_SECONDS = 3600  # 1 hour window


def _get_redis():
    global _sync_redis
    if _sync_redis is None and getattr(settings, "REDIS_URL", None):
        try:
            _sync_redis = redis.Redis.from_url(
                settings.REDIS_URL, decode_responses=True, socket_connect_timeout=0.5
            )
            _sync_redis.ping()
        except Exception:
            _sync_redis = None
    return _sync_redis


def check_and_increment_rate_limit(user_id: str, limit: int | None = None) -> int:
    """
    Checks if user has exceeded their hourly quota for the platform default model.
    Raises HTTP 429 if exceeded. Returns remaining queries for the hour.
    """
    max_queries = limit or settings.AI_HOURLY_RATE_LIMIT
    now = time.time()
    r = _get_redis()

    if r:
        try:
            key = f"renopay:ai:ratelimit:{user_id}"
            cutoff = now - WINDOW_SECONDS
            pipe = r.pipeline()
            pipe.zremrangebyscore(key, 0, cutoff)
            pipe.zcard(key)
            results = pipe.execute()
            count = results[1]

            if count >= max_queries:
                oldest_items = r.zrange(key, 0, 0, withscores=True)
                oldest = oldest_items[0][1] if oldest_items else now
                retry_after_min = max(1, int((oldest + WINDOW_SECONDS - now) / 60))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"Hourly free AI limit reached ({max_queries} queries/hour). "
                        f"Resets in ~{retry_after_min} minutes. "
                        "To get unlimited queries without rate limits, add your own API key in AI Assistant Setup!"
                    ),
                )

            pipe = r.pipeline()
            pipe.zadd(key, {str(now): now})
            pipe.expire(key, WINDOW_SECONDS)
            pipe.execute()
            return max_queries - (count + 1)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Redis error in AI rate limiter (%s), using in-memory", e)

    # In-memory sliding window fallback
    cutoff = now - WINDOW_SECONDS
    timestamps = [t for t in _memory_timestamps[str(user_id)] if t > cutoff]
    _memory_timestamps[str(user_id)] = timestamps

    if len(timestamps) >= max_queries:
        oldest = timestamps[0]
        retry_after_min = max(1, int((oldest + WINDOW_SECONDS - now) / 60))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Hourly free AI limit reached ({max_queries} queries/hour). "
                f"Resets in ~{retry_after_min} minutes. "
                "To get unlimited queries without rate limits, add your own API key in AI Assistant Setup!"
            ),
        )

    _memory_timestamps[str(user_id)].append(now)
    return max_queries - len(_memory_timestamps[str(user_id)])


def get_user_rate_limit_status(user_id: str, limit: int | None = None) -> dict:
    """
    Returns current rate limit status for display in the UI.
    """
    max_queries = limit or settings.AI_HOURLY_RATE_LIMIT
    now = time.time()
    r = _get_redis()

    if r:
        try:
            key = f"renopay:ai:ratelimit:{user_id}"
            cutoff = now - WINDOW_SECONDS
            r.zremrangebyscore(key, 0, cutoff)
            count = r.zcard(key)
            oldest_items = r.zrange(key, 0, 0, withscores=True)
            resets_in = max(0, int(oldest_items[0][1] + WINDOW_SECONDS - now)) if oldest_items else 0
            return {
                "used": count,
                "limit": max_queries,
                "remaining": max(0, max_queries - count),
                "resets_in_seconds": resets_in,
            }
        except Exception:
            pass

    cutoff = now - WINDOW_SECONDS
    timestamps = [t for t in _memory_timestamps.get(str(user_id), []) if t > cutoff]
    return {
        "used": len(timestamps),
        "limit": max_queries,
        "remaining": max(0, max_queries - len(timestamps)),
        "resets_in_seconds": max(0, int(timestamps[0] + WINDOW_SECONDS - now)) if timestamps else 0,
    }
