from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import torch
from PIL import Image
from qwen_vl_utils import process_vision_info
from ultralytics import YOLO


BINARY_PROMPT = """You are the semantic verification layer after a high-recall DamageNet detector.
Review only the highlighted candidate using the full-image context and padded crop.
Normal vehicle structures, reflections, shadows, dirt, panel gaps/seams, lights,
mirrors, and image/compression artifacts are NOT damage. If evidence is
insufficient, answer NO. Answer with exactly one token: YES or NO."""


def sync_cuda() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def quantiles(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"mean": None, "median": None, "p95": None}
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * 0.95 + 0.999999)))
    return {
        "mean": round(statistics.fmean(values), 3),
        "median": round(statistics.median(values), 3),
        "p95": round(ordered[index], 3),
    }


def prepare_candidate(image: Any, detection: dict[str, Any]) -> tuple[Image.Image, Image.Image]:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    height, width = image.shape[:2]
    x1, y1, x2, y2 = detection["bbox_xyxy"]
    pad_x, pad_y = (x2 - x1) * 0.2, (y2 - y1) * 0.2
    left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
    right, bottom = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
    if right <= left or bottom <= top:
        raise ValueError("invalid candidate bbox")
    highlighted = rgb.copy()
    cv2.rectangle(
        highlighted,
        (max(0, int(x1)), max(0, int(y1))),
        (min(width - 1, int(x2)), min(height - 1, int(y2))),
        (255, 0, 0),
        5,
    )
    cv2.putText(
        highlighted,
        "candidate 1",
        (max(0, int(x1)), max(24, int(y1) - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (255, 0, 0),
        2,
        cv2.LINE_AA,
    )
    return Image.fromarray(highlighted), Image.fromarray(rgb[top:bottom, left:right])


def build_messages(mode: str, images: tuple[Image.Image, Image.Image], detection: dict[str, Any], json_prompt: str) -> list[dict[str, Any]]:
    prompt = (
        json_prompt + json.dumps([{**detection, "candidate_id": 1, "source_index": 0}], ensure_ascii=False)
        if mode == "json"
        else BINARY_PROMPT
    )
    return [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Candidate 1: full-image context with red bbox."},
            {"type": "image", "image": images[0]},
            {"type": "text", "text": "Candidate 1: padded crop."},
            {"type": "image", "image": images[1]},
            {"type": "text", "text": prompt},
        ],
    }]


def run_one(ai_app: Any, json_parser: Any, mode: str, candidate: dict[str, Any]) -> dict[str, Any]:
    messages = build_messages(mode, candidate["images"], candidate["detection"], ai_app.QWEN_PROMPT)
    sync_cuda()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    wall_started = time.perf_counter()
    preprocess_started = wall_started
    chat_text = ai_app.state.qwen_processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = ai_app.state.qwen_processor(
        text=[chat_text], images=image_inputs, videos=video_inputs,
        padding=True, return_tensors="pt",
    ).to(ai_app.state.qwen_device)
    sync_cuda()
    preprocess_ms = (time.perf_counter() - preprocess_started) * 1000

    generate_started = time.perf_counter()
    with torch.inference_mode():
        generated = ai_app.state.qwen_model.generate(
            **inputs, max_new_tokens=512 if mode == "json" else 4, do_sample=False
        )
    sync_cuda()
    generate_ms = (time.perf_counter() - generate_started) * 1000
    generated_tokens = int(generated.shape[-1] - inputs.input_ids.shape[-1])

    decode_started = time.perf_counter()
    trimmed = [output[len(input_ids):] for input_ids, output in zip(inputs.input_ids, generated)]
    response = ai_app.state.qwen_processor.batch_decode(trimmed, skip_special_tokens=True)[0]
    decode_ms = (time.perf_counter() - decode_started) * 1000

    parse_started = time.perf_counter()
    valid = True
    verdict: bool | None = None
    try:
        if mode == "json":
            verdict = bool(json_parser(response, [1])[0]["is_damage"])
        else:
            normalized = response.strip().upper()
            if normalized not in {"YES", "NO"}:
                raise ValueError("binary response was not exactly YES or NO")
            verdict = normalized == "YES"
    except Exception:
        valid = False
    parse_ms = (time.perf_counter() - parse_started) * 1000
    sync_cuda()
    wall_ms = (time.perf_counter() - wall_started) * 1000
    return {
        "mode": mode,
        "valid": valid,
        "verdict": verdict,
        "preprocess_ms": round(preprocess_ms, 3),
        "generate_ms": round(generate_ms, 3),
        "decode_ms": round(decode_ms, 3),
        "parse_ms": round(parse_ms, 3),
        "wall_ms": round(wall_ms, 3),
        "generated_tokens": generated_tokens,
        "peak_allocated_mib": round(torch.cuda.max_memory_allocated() / 1024 / 1024, 3) if torch.cuda.is_available() else 0,
        "peak_reserved_mib": round(torch.cuda.max_memory_reserved() / 1024 / 1024, 3) if torch.cuda.is_available() else 0,
    }


def aggregate(records: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    rows = [row[mode] for row in records]
    return {
        "count": len(rows),
        "valid_count": sum(bool(row["valid"]) for row in rows),
        "valid_rate": round(sum(bool(row["valid"]) for row in rows) / len(rows), 4) if rows else None,
        "generated_tokens": quantiles([float(row["generated_tokens"]) for row in rows]),
        "preprocess_ms": quantiles([row["preprocess_ms"] for row in rows]),
        "generate_ms": quantiles([row["generate_ms"] for row in rows]),
        "decode_ms": quantiles([row["decode_ms"] for row in rows]),
        "parse_ms": quantiles([row["parse_ms"] for row in rows]),
        "wall_ms": quantiles([row["wall_ms"] for row in rows]),
        "peak_allocated_mib": quantiles([row["peak_allocated_mib"] for row in rows]),
        "peak_reserved_mib": quantiles([row["peak_reserved_mib"] for row in rows]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(script_dir))
    import app as ai_app
    from qwen_contract import parse_qwen_response

    image_paths = sorted([*args.images.glob("*.jpg"), *args.images.glob("*.jpeg"), *args.images.glob("*.png")])
    if len(image_paths) != 7:
        raise SystemExit(f"expected 7 test photos, found {len(image_paths)}")

    damage_started = time.perf_counter()
    damage_model = YOLO(Path(os.environ["DAMAGENET_ROOT"]) / "model.pt")
    candidates: list[dict[str, Any]] = []
    photo_candidate_counts: dict[str, int] = {}
    for photo_index, image_path in enumerate(image_paths, 1):
        image = cv2.imread(str(image_path))
        if image is None:
            raise RuntimeError("test image decode failed")
        predictions = damage_model.predict(source=image, conf=0.15, iou=0.60, imgsz=640, save=False, verbose=False, device="cpu")
        photo_id = f"p{photo_index:02d}"
        photo_candidate_counts[photo_id] = len(predictions[0].boxes)
        for candidate_index, box in enumerate(predictions[0].boxes, 1):
            label_id = int(box.cls.item())
            detection = {
                "label_id": label_id,
                "label": ai_app.ALLOWED_LABELS[label_id],
                "confidence": float(box.conf.item()),
                "bbox_xyxy": [float(value) for value in box.xyxy[0].tolist()],
            }
            candidates.append({
                "photo_id": photo_id,
                "candidate_id": f"{photo_id}c{candidate_index:02d}",
                "detection": detection,
                "images": prepare_candidate(image, detection),
            })
    damage_seconds = time.perf_counter() - damage_started
    del damage_model
    if not candidates:
        raise SystemExit("DamageNet produced no candidates")

    load_started = time.perf_counter()
    ai_app.load_qwen()
    load_seconds = time.perf_counter() - load_started
    if ai_app.state.qwen_model is None:
        raise RuntimeError(ai_app.state.qwen_error or "Qwen failed to load")

    smoke = {}
    for mode in ("json", "binary"):
        smoke[mode] = run_one(ai_app, parse_qwen_response, mode, candidates[0])

    records: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        order = ("json", "binary") if index % 2 == 0 else ("binary", "json")
        row: dict[str, Any] = {
            "photo_id": candidate["photo_id"],
            "candidate_id": candidate["candidate_id"],
            "label": candidate["detection"]["label"],
            "detector_confidence": round(candidate["detection"]["confidence"], 6),
            "order": list(order),
        }
        for mode in order:
            row[mode] = run_one(ai_app, parse_qwen_response, mode, candidate)
        records.append(row)
        print(f"completed {index + 1}/{len(candidates)}", flush=True)

    comparable = [row for row in records if row["json"]["valid"] and row["binary"]["valid"]]
    candidate_agree = sum(row["json"]["verdict"] == row["binary"]["verdict"] for row in comparable)
    photo_rows = []
    for photo_id in photo_candidate_counts:
        included = [row for row in records if row["photo_id"] == photo_id]
        verdicts: dict[str, bool | None] = {}
        valid: dict[str, bool] = {}
        for mode in ("json", "binary"):
            valid[mode] = all(row[mode]["valid"] for row in included)
            verdicts[mode] = any(bool(row[mode]["verdict"]) for row in included) if valid[mode] else None
        photo_rows.append({
            "photo_id": photo_id,
            "candidate_count": len(included),
            "json_valid": valid["json"],
            "binary_valid": valid["binary"],
            "json_any_damage": verdicts["json"],
            "binary_any_damage": verdicts["binary"],
            "agree": valid["json"] and valid["binary"] and verdicts["json"] == verdicts["binary"],
        })
    comparable_photos = [row for row in photo_rows if row["json_valid"] and row["binary_valid"]]

    output = {
        "schema": "qwen-json-binary-ab.v1",
        "notes": [
            "No human ground truth; agreement and performance only, not precision/recall.",
            "Raw photos, filenames, bboxes, prompts, and model responses are omitted.",
            "Smoke runs are warmup-only and excluded from aggregate statistics.",
        ],
        "configuration": {
            "photo_count": len(image_paths),
            "candidate_count": len(candidates),
            "device": ai_app.state.qwen_device,
            "quantization": ai_app.state.qwen_quantization,
            "model_id_sha256_12": hashlib.sha256(os.environ.get("QWEN_MODEL_ID", "").encode()).hexdigest()[:12],
            "json_max_new_tokens": 512,
            "binary_max_new_tokens": 4,
            "damage_seconds": round(damage_seconds, 3),
            "qwen_load_seconds": round(load_seconds, 3),
        },
        "photo_candidate_counts": photo_candidate_counts,
        "smoke": smoke,
        "aggregate": {"json": aggregate(records, "json"), "binary": aggregate(records, "binary")},
        "agreement": {
            "candidate_comparable_count": len(comparable),
            "candidate_agree_count": candidate_agree,
            "candidate_agreement_rate": round(candidate_agree / len(comparable), 4) if comparable else None,
            "photo_comparable_count": len(comparable_photos),
            "photo_agree_count": sum(row["agree"] for row in comparable_photos),
            "photo_agreement_rate": round(sum(row["agree"] for row in comparable_photos) / len(comparable_photos), 4) if comparable_photos else None,
        },
        "photos": photo_rows,
        "candidates": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "aggregate": output["aggregate"], "agreement": output["agreement"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
