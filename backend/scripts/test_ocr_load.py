import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.extraction import EXTRACTION_MODEL_CONFIG, EXTRACTION_MODEL_SRC
from app.qvac_client import qvac_model


async def main():
    print("Loading OCR model...", flush=True)
    async with qvac_model(EXTRACTION_MODEL_SRC, EXTRACTION_MODEL_CONFIG) as model:
        print("Loaded OK:", model.model_id, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
