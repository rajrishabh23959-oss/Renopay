"""
Safe, TTL-governed Redis caching module with in-memory fallback.
Rule: NEVER cache balances, payment execution states, or PIN checks.
Only cache safe read-heavy data: gold rates, VPA resolution, reward summaries, and analytics aggregates.
"""
import json
import time
from typing import Any
from app.core.config import settings
from app.core.logging import logger

_memory_cache: dict[str, tuple[float, Any]] = {}
_async_redis_client = None


async def get_redis_cache():
    global _async_redis_client
    if _async_redis_client is None and getattr(settings, "REDIS_URL", None):
        try:
            import redis.asyncio as aioredis
            _async_redis_client = aioredis.from_url(
                settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1.0
            )
            await _async_redis_client.ping()
        except Exception:
            _async_redis_client = None
    return _async_redis_client


async def get_cached(key: str) -> Any:
    """Retrieve value from Redis or in-memory fallback if not expired."""
    r = await get_redis_cache()
    if r:
        try:
            val = await r.get(f"renopay:cache:{key}")
            if val is not None:
                return json.loads(val)
        except Exception as e:
            logger.debug("Redis cache get error (%s), checking in-memory", e)

    # In-memory fallback
    if key in _memory_cache:
        expire_at, data = _memory_cache[key]
        if time.time() < expire_at:
            return data
        else:
            del _memory_cache[key]
    return None


async def set_cached(key: str, value: Any, ttl_seconds: int = 60) -> None:
    """Store value in cache with explicit expiration."""
    r = await get_redis_cache()
    if r:
        try:
            await r.set(f"renopay:cache:{key}", json.dumps(value, default=str), ex=ttl_seconds)
            return
        except Exception as e:
            logger.debug("Redis cache set error (%s), using in-memory", e)

    # In-memory fallback
    _memory_cache[key] = (time.time() + ttl_seconds, value)


async def invalidate_cache_key(key: str) -> None:
    """Invalidate a specific cache key."""
    r = await get_redis_cache()
    if r:
        try:
            await r.delete(f"renopay:cache:{key}")
        except Exception:
            pass
    _memory_cache.pop(key, None)


async def invalidate_cache_prefix(prefix: str) -> None:
    """Invalidate all cache keys matching a prefix (e.g. 'analytics:{account_id}')."""
    r = await get_redis_cache()
    if r:
        try:
            keys = await r.keys(f"renopay:cache:{prefix}*")
            if keys:
                await r.delete(*keys)
        except Exception:
            pass

    for k in list(_memory_cache.keys()):
        if k.startswith(prefix):
            _memory_cache.pop(k, None)
