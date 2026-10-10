"""
Replaces polling with real-time push events to all sockets open for a user_id.
Encapsulates connection state and provides multi-worker Redis pub/sub fan-out.
"""
import json
import uuid

from fastapi import WebSocket
from app.core.config import settings


class ConnectionManager:
    def __init__(self):
        # Maps user_id_str -> list of active WebSocket connections
        self._connections: dict[str, list[WebSocket]] = {}
        self.MAX_CONNECTIONS_PER_USER = 5
        self._redis_client = None

    async def register_connection(self, user_id: uuid.UUID, websocket: WebSocket):
        """Safely register an authenticated WebSocket connection with quota limits."""
        user_id_str = str(user_id)
        if user_id_str not in self._connections:
            self._connections[user_id_str] = []

        if len(self._connections[user_id_str]) >= self.MAX_CONNECTIONS_PER_USER:
            oldest = self._connections[user_id_str].pop(0)
            try:
                await oldest.close(code=1008, reason="Too many connections")
            except Exception:
                pass

        self._connections[user_id_str].append(websocket)

    def disconnect(self, user_id: uuid.UUID, ws: WebSocket):
        """Deregister a WebSocket connection safely."""
        user_id_str = str(user_id)
        conns = self._connections.get(user_id_str, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(user_id_str, None)

    async def push_local(self, user_id: uuid.UUID, event_type: str, data: dict):
        """Direct delivery to sockets connected to this local worker instance."""
        user_id_str = str(user_id)
        conns = list(self._connections.get(user_id_str, []))
        payload = json.dumps({"type": event_type, "data": data}, default=str)
        dead = []
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def push(self, user_id: uuid.UUID, event_type: str, data: dict):
        """Push an event to the user across local connections and broadcast to Redis cluster."""
        await self.push_local(user_id, event_type, data)
        try:
            if self._redis_client is None and getattr(settings, "REDIS_URL", None):
                import redis.asyncio as aioredis
                self._redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            if self._redis_client:
                msg = json.dumps({"user_id": str(user_id), "event_type": event_type, "data": data}, default=str)
                await self._redis_client.publish("renopay:ws:events", msg)
        except Exception:
            pass


manager = ConnectionManager()
