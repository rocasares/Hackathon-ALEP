from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

from tetherto.qvac_sdk import Client, completion, load_model, unload_model


class LoadedModel:
    def __init__(self, transport, model_id: str):
        self.transport = transport
        self.model_id = model_id

    async def json_completion(
        self,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str,
        attachments: list[str] | None = None,
        temp: float = 0.1,
        retries: int = 2,
    ) -> dict[str, Any]:
        history = [{"role": "user", "content": prompt}]
        if attachments:
            history[0]["attachments"] = [{"path": p} for p in attachments]

        last_error: Exception | None = None
        for attempt in range(retries + 1):
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
        try:
            yield LoadedModel(t, model_id)
        finally:
            await unload_model(t, model_id)
