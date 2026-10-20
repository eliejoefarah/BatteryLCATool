"""ASGI middleware that guards /api/v1 requests before their body is read.

FastAPI parses a multipart body (spooling file parts to disk) before it runs
endpoint dependencies, so the JWT check and the 50 MB size check in the
routers only happen after an arbitrarily large upload has been written to
disk. This middleware runs first:

  1. rejects a declared Content-Length above MAX_REQUEST_BODY (413),
  2. verifies the bearer token (401) — every /api/v1 endpoint requires one,
  3. counts the bytes of bodies without a Content-Length (chunked) and stops
     at MAX_REQUEST_BODY (413).

Endpoint dependencies still do the real authorization (membership, admin);
this is only a cheap gate in front of them.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from fastapi import HTTPException

# The import endpoint's file limit is 50 MB; allow for multipart overhead.
MAX_REQUEST_BODY = 52 * 1024 * 1024

ASGIApp = Callable[..., Awaitable[None]]


class ApiRequestGuard:
    def __init__(self, app: ASGIApp, verify_token: Callable[[str | None], Awaitable[object]]):
        self.app = app
        self.verify_token = verify_token

    async def __call__(self, scope, receive, send) -> None:
        if (
            scope["type"] != "http"
            or not scope["path"].startswith("/api/v1/")
            or scope["method"] == "OPTIONS"  # CORS preflight carries no token
        ):
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])

        length = headers.get(b"content-length")
        if length is not None:
            try:
                declared = int(length)
            except ValueError:
                await _reply(send, 400, "Invalid Content-Length.")
                return
            if declared > MAX_REQUEST_BODY:
                await _reply(send, 413, _too_large())
                return

        auth = headers.get(b"authorization")
        try:
            await self.verify_token(auth.decode("latin-1") if auth else None)
        except HTTPException as exc:
            await _reply(send, exc.status_code, str(exc.detail))
            return

        received = 0

        async def counted_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BODY:
                    # Raised inside body parsing; FastAPI passes HTTPException
                    # through, so the client gets a 413.
                    raise HTTPException(status_code=413, detail=_too_large())
            return message

        await self.app(scope, counted_receive, send)


def _too_large() -> str:
    return f"Request too large — maximum is {MAX_REQUEST_BODY // (1024 * 1024)} MB."


async def _reply(send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})
