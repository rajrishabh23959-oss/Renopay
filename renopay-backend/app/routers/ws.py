import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.ws.manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
):
    await websocket.accept()
    try:
        auth_msg = await websocket.receive_text()
        auth_data = json.loads(auth_msg)
        if auth_data.get("type") != "auth" or not auth_data.get("token"):
            await websocket.close(code=4401)
            return
        user_id = decode_access_token(auth_data["token"])
        if not user_id:
            await websocket.close(code=4401)
            return
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        return

    # SEC-07: Register connection via encapsulated manager
    await manager.register_connection(user_id, websocket)

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
