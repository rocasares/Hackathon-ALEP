from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

from tetherto.qvac_sdk import Client, completion, load_model, unload_model
from tetherto.qvac_sdk.errors import ContextOverflowError, RPCError


class LoadedModel:
    def __init__(self, transport, model_id: str, model_src=None, model_config: dict[str, Any] | None = None):
        self.transport = transport
        self.model_id = model_id
        # kept so json_completion can reload itself after a context overflow
        self._model_src = model_src
        self._model_config = model_config

    async def _reload(self) -> None:
        await unload_model(self.transport, self.model_id)
        self.model_id = await load_model(self.transport, model_src=self._model_src, model_config=self._model_config)

    async def json_completion(
        self,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str,
        attachments: list[str] | None = None,
        temp: float = 0.1,
        retries: int = 3,
    ) -> dict[str, Any]:
        history = [{"role": "user", "content": prompt}]
        if attachments:
            history[0]["attachments"] = [{"path": p} for p in attachments]

        last_error: Exception | None = None
        for attempt in range(retries + 1):
            try:
                run = completion(
                    self.transport,
                    model_id=self.model_id,
                    history=history,
                    response_format={
                        "type": "json_schema",
                        "json_schema": {"name": schema_name, "schema": schema},
                    },
                    # json_schema-constrained decoding occasionally cuts a
                    # response short (observed on the vision model) -- a retry
                    # with a bumped temperature usually gets a clean completion.
                    generation_params={"temp": temp + attempt * 0.15, "predict": 400},
                )
                text = await run.text()
            except ContextOverflowError:
                # Long sequences of calls on one session eventually fill the
                # model's context window. Reload for a clean slate and retry
                # this same call, rather than aborting the whole caller.
                last_error = None
                if self._model_src is None:
                    raise
                await self._reload()
                continue
            except RPCError as exc:
                # Observed as a generic 'std::exception' from the native
                # worker, seemingly during/just after a model load (grammar
                # sampler init failing on the first constrained-decoding call)
                # -- transient, not a real incompatibility: a reload usually
                # clears it. Without this, one flaky call kills an entire
                # reconciliation run after the (expensive) extraction stage
                # already finished.
                last_error = exc
                if self._model_src is None:
                    raise
                await self._reload()
                await asyncio.sleep(2)
                continue
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                last_error = exc
        raise last_error


@asynccontextmanager
async def qvac_model(model_src, model_config: dict[str, Any] | None = None):
    """Loads one model for the duration of the `with` block and unloads it
    on exit. Keeping only one model resident at a time matters on 8GB RAM.
    """
    async with Client() as client:
        t = client.transport
        model_id = await load_model(t, model_src=model_src, model_config=model_config)
        loaded = LoadedModel(t, model_id, model_src=model_src, model_config=model_config)
        try:
            yield loaded
        finally:
            await unload_model(loaded.transport, loaded.model_id)
