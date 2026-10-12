from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import cv2
import torch

import app as ai_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark one Qwen damage-verification candidate")
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    image = cv2.imread(str(args.image))
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")

    os.environ.setdefault("QWEN_VLM_ENABLED", "true")
    os.environ.setdefault("QWEN_DEVICE", "cuda")
    os.environ.setdefault("QWEN_QUANTIZATION", "4bit")
    height, width = image.shape[:2]
    candidate = {
        "label_id": 0,
        "label": "Scratched",
        "confidence": 0.5,
        "bbox_xyxy": [width * 0.25, height * 0.25, width * 0.75, height * 0.75],
    }

    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    load_started = time.perf_counter()
    ai_app.load_qwen()
    load_seconds = time.perf_counter() - load_started
    if ai_app.state.qwen_model is None:
        raise SystemExit(ai_app.state.qwen_error or "Qwen failed to load")
    result = ai_app.verify_damage_candidates(image, [candidate])
    peak_mib = torch.cuda.max_memory_allocated() / 1024 / 1024 if torch.cuda.is_available() else 0
    print(json.dumps({
        "device": ai_app.state.qwen_device,
        "quantization": ai_app.state.qwen_quantization,
        "load_seconds": load_seconds,
        "peak_cuda_memory_mib": peak_mib,
        "result": result,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
