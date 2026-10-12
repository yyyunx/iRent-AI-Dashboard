from __future__ import annotations

import base64
import binascii
import json
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO
from ultralytics.utils.nms import non_max_suppression
from qwen_contract import (
    LEGACY_QWEN_PROMPT,
    QWEN_PROMPT,
    RECALL_V3_QWEN_PROMPT,
    parse_qwen_response,
    parse_recall_v3_response,
)
from vehicle_gate import vehicle_gate_passes

PROJECT_ROOT = Path(__file__).resolve().parents[1]
IRENT_ROOT = PROJECT_ROOT.parent
KPTNET_ROOT = Path(os.getenv("KPTNET_ROOT", IRENT_ROOT / "kptnetv1")).resolve()
DAMAGENET_ROOT = Path(os.getenv("DAMAGENET_ROOT", IRENT_ROOT / "damagenetv1")).resolve()
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_LABELS = {0: "Scratched", 1: "Dented", 2: "Broken"}

sys.path.insert(0, str(KPTNET_ROOT))
from kptnetv1 import KptNetV1  # noqa: E402
from kptnetv1.preprocessing import letterbox, to_original_xy  # noqa: E402
from guidance import LandmarkConfigurationError, load_landmark_map, solve_guidance  # noqa: E402


class ImageRequest(BaseModel):
    image_data: str


class ModelState:
    kpt: KptNetV1 | None = None
    damage: YOLO | None = None
    qwen_model: Any | None = None
    qwen_processor: Any | None = None
    qwen_error: str | None = None
    qwen_device: str = "cpu"
    qwen_quantization: str = "none"
    load_seconds: float | None = None
    landmarks: dict[str, np.ndarray] | None = None
    landmark_validation: dict[str, Any] | None = None


state = ModelState()
kpt_lock = threading.Lock()
damage_lock = threading.Lock()
qwen_lock = threading.Lock()


def _log_qwen_timing(*, scope: str, request_id: str, candidate_count: int,
                     qwen_lock_wait_ms: float, preprocess_ms: float,
                     generate_ms: float, parse_ms: float, overall_ms: float,
                     batch_index: int | None = None, status: str = "success") -> None:
    fields = [
        "[QwenTiming]", f"scope={scope}", f"request_id={request_id}",
        f"status={status}", f"candidates={candidate_count}",
    ]
    if batch_index is not None:
        fields.append(f"batch_index={batch_index}")
    fields.extend([
        f"qwen_lock_wait_ms={qwen_lock_wait_ms:.3f}",
        f"preprocess_ms={preprocess_ms:.3f}", f"generate_ms={generate_ms:.3f}",
        f"parse_ms={parse_ms:.3f}", f"overall_ms={overall_ms:.3f}",
    ])
    print(" ".join(fields), flush=True)


def qwen_enabled() -> bool:
    return os.getenv("QWEN_VLM_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def qwen_structured_json_version() -> str:
    version = os.getenv("QWEN_STRUCTURED_JSON_VERSION", "v3").strip().lower()
    if version not in {"v3", "legacy"}:
        raise ValueError("QWEN_STRUCTURED_JSON_VERSION must be 'v3' or 'legacy'")
    return version


def load_qwen() -> None:
    if not qwen_enabled():
        return
    try:
        from transformers import AutoProcessor, BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration

        model_id = os.getenv("QWEN_MODEL_ID", "Qwen/Qwen2.5-VL-3B-Instruct")
        requested_device = os.getenv("QWEN_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
        device = requested_device if requested_device.startswith("cuda") and torch.cuda.is_available() else "cpu"
        quantization = os.getenv("QWEN_QUANTIZATION", "4bit" if device.startswith("cuda") else "none").lower()
        min_pixels = max(28 * 28, int(os.getenv("QWEN_MIN_PIXELS", str(256 * 28 * 28))))
        max_pixels = max(min_pixels, int(os.getenv("QWEN_MAX_PIXELS", str(512 * 28 * 28))))
        state.qwen_processor = AutoProcessor.from_pretrained(
            model_id, min_pixels=min_pixels, max_pixels=max_pixels
        )
        model_kwargs: dict[str, Any] = {"low_cpu_mem_usage": True}
        if device.startswith("cuda") and quantization == "4bit":
            model_kwargs.update({
                "device_map": {"": device},
                "torch_dtype": torch.float16,
                "quantization_config": BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_compute_dtype=torch.float16,
                ),
            })
            state.qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_id, **model_kwargs
            ).eval()
        else:
            dtype = torch.float16 if device.startswith("cuda") else torch.float32
            state.qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_id, torch_dtype=dtype, **model_kwargs
            ).to(device).eval()
            quantization = "none"
        state.qwen_device = device
        state.qwen_quantization = quantization
    except Exception as exc:
        state.qwen_error = f"{type(exc).__name__}: {exc}"[:300]


def verify_damage_candidates(image: np.ndarray, detections: list[dict[str, Any]]) -> dict[str, Any]:
    request_id = uuid.uuid4().hex[:12]
    request_started = time.perf_counter()
    request_timings = {"qwen_lock_wait_ms": 0.0, "preprocess_ms": 0.0, "generate_ms": 0.0, "parse_ms": 0.0}
    result_status: str | None = None
    try:
        result = _verify_damage_candidates(image, detections, request_id, request_timings)
        result_status = str(result.get("status", "success"))
        return result
    except Exception:
        _log_qwen_timing(
            scope="request", request_id=request_id, candidate_count=len(detections),
            overall_ms=(time.perf_counter() - request_started) * 1000,
            status="failed", **request_timings,
        )
        raise
    finally:
        if result_status is not None:
            _log_qwen_timing(
                scope="request", request_id=request_id, candidate_count=len(detections),
                overall_ms=(time.perf_counter() - request_started) * 1000,
                status=result_status,
                **request_timings,
            )


def _verify_damage_candidates(image: np.ndarray, detections: list[dict[str, Any]], request_id: str,
                              request_timings: dict[str, float]) -> dict[str, Any]:
    if not detections:
        print("[Qwen] verifying 0 candidates (skipped)", flush=True)
        return {"status": "skipped_no_candidates", "model": None, "failure_reason": None, "verifications": []}
    if not qwen_enabled():
        print(f"[Qwen] unavailable status=disabled candidates={len(detections)} reason=QWEN_VLM_DISABLED", flush=True)
        return {"status": "disabled", "model": None, "failure_reason": "QWEN_VLM_DISABLED", "verifications": []}
    if state.qwen_model is None or state.qwen_processor is None:
        reason = state.qwen_error or "QWEN_NOT_LOADED"
        print(f"[Qwen] unavailable status=unavailable candidates={len(detections)} reason={reason}", flush=True)
        return {"status": "unavailable", "model": os.getenv("QWEN_MODEL_ID", "Qwen/Qwen2.5-VL-3B-Instruct"), "failure_reason": state.qwen_error or "QWEN_NOT_LOADED", "verifications": []}

    print(f"[Qwen] verifying {len(detections)} candidates", flush=True)

    from PIL import Image
    from qwen_vl_utils import process_vision_info
    from transformers import StoppingCriteria, StoppingCriteriaList

    initial_preprocess_started = time.perf_counter()
    structured_json_version = qwen_structured_json_version()
    batch_size = 1 if structured_json_version == "v3" else max(1, min(int(os.getenv("QWEN_BATCH_SIZE", "1")), 12))
    selected = list(enumerate(detections))
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    metadata = []
    height, width = image.shape[:2]
    candidate_images: dict[int, tuple[Any, Any]] = {}
    for source_index, detection in selected:
        candidate_id = source_index + 1
        x1, y1, x2, y2 = detection["bbox_xyxy"]
        pad_x, pad_y = (x2 - x1) * 0.2, (y2 - y1) * 0.2
        left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
        right, bottom = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
        if right <= left or bottom <= top:
            raise ValueError("DamageNet returned an invalid candidate bbox")
        highlighted = rgb.copy()
        cv2.rectangle(highlighted, (max(0, int(x1)), max(0, int(y1))),
                      (min(width - 1, int(x2)), min(height - 1, int(y2))), (255, 0, 0), 5)
        cv2.putText(highlighted, f"candidate {candidate_id}", (max(0, int(x1)), max(24, int(y1) - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 0, 0), 2, cv2.LINE_AA)
        candidate_images[candidate_id] = (Image.fromarray(highlighted), Image.fromarray(rgb[top:bottom, left:right]))
        metadata.append({"candidate_id": candidate_id, "source_index": source_index, **detection})
    request_timings["preprocess_ms"] += (time.perf_counter() - initial_preprocess_started) * 1000
    timeout_seconds = max(1.0, float(os.getenv("QWEN_TIMEOUT_SECONDS", "45")))
    overall_started = time.perf_counter()
    verifications: list[dict[str, Any]] = []
    for offset in range(0, len(metadata), batch_size):
        batch_index = offset // batch_size + 1
        timing_started = time.perf_counter()
        preprocess_started = timing_started
        batch = metadata[offset:offset + batch_size]
        content: list[dict[str, Any]] = []
        for item in batch:
            context_image, crop_image = candidate_images[item["candidate_id"]]
            content.extend([
                {"type": "text", "text": f'Candidate {item["candidate_id"]}: full-image context with red bbox.'},
                {"type": "image", "image": context_image},
                {"type": "text", "text": f'Candidate {item["candidate_id"]}: padded crop.'},
                {"type": "image", "image": crop_image},
            ])
        prompt = RECALL_V3_QWEN_PROMPT if structured_json_version == "v3" else LEGACY_QWEN_PROMPT
        content.append({"type": "text", "text": prompt + json.dumps(batch, ensure_ascii=False)})
        messages = [{"role": "user", "content": content}]
        chat_text = state.qwen_processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = state.qwen_processor(text=[chat_text], images=image_inputs, videos=video_inputs, padding=True, return_tensors="pt").to(state.qwen_device)
        preprocess_ms = (time.perf_counter() - preprocess_started) * 1000
        batch_started = time.perf_counter()

        class DeadlineStoppingCriteria(StoppingCriteria):
            def __call__(self, _input_ids: Any, _scores: Any, **_kwargs: Any) -> bool:
                return time.perf_counter() - batch_started >= timeout_seconds

        lock_wait_started = time.perf_counter()
        qwen_lock_wait_ms = generate_ms = parse_ms = 0.0
        batch_status = "failed"
        try:
            with qwen_lock:
                lock_acquired = time.perf_counter()
                qwen_lock_wait_ms = (lock_acquired - lock_wait_started) * 1000
                generate_started = lock_acquired
                try:
                    with torch.inference_mode():
                        generated = state.qwen_model.generate(
                            **inputs,
                            max_new_tokens=64 if structured_json_version == "v3" else 512,
                            do_sample=False,
                            stopping_criteria=StoppingCriteriaList([DeadlineStoppingCriteria()]),
                        )
                finally:
                    generate_ms = (time.perf_counter() - generate_started) * 1000
            if time.perf_counter() - batch_started >= timeout_seconds:
                raise TimeoutError(f"Qwen inference exceeded {timeout_seconds:g} seconds")
            parse_started = time.perf_counter()
            try:
                trimmed = [output[len(input_ids):] for input_ids, output in zip(inputs.input_ids, generated)]
                response_text = state.qwen_processor.batch_decode(trimmed, skip_special_tokens=True)[0]
                if structured_json_version == "v3":
                    if len(batch) != 1:
                        raise ValueError("Recall-oriented V3 requires QWEN_BATCH_SIZE=1")
                    parsed = [parse_recall_v3_response(response_text, batch[0]["candidate_id"])]
                else:
                    parsed = parse_qwen_response(response_text, [item["candidate_id"] for item in batch])
            finally:
                parse_ms = (time.perf_counter() - parse_started) * 1000
            batch_status = "success"
        finally:
            batch_overall_ms = (time.perf_counter() - timing_started) * 1000
            request_timings["qwen_lock_wait_ms"] += qwen_lock_wait_ms
            request_timings["preprocess_ms"] += preprocess_ms
            request_timings["generate_ms"] += generate_ms
            request_timings["parse_ms"] += parse_ms
            _log_qwen_timing(
                scope="batch", request_id=request_id, batch_index=batch_index,
                candidate_count=len(batch), qwen_lock_wait_ms=qwen_lock_wait_ms,
                preprocess_ms=preprocess_ms, generate_ms=generate_ms, parse_ms=parse_ms,
                overall_ms=batch_overall_ms, status=batch_status,
            )
        by_id = {item["candidate_id"]: item for item in batch}
        for verification in parsed:
            if structured_json_version == "v3":
                # V3 deliberately omits a self-reported probability. Retain the
                # detector confidence already present in candidate metadata so
                # the established verification/DB/LINE contract stays numeric.
                verification["confidence"] = float(by_id[verification["candidate_id"]]["confidence"])
            verification["source_index"] = by_id[verification["candidate_id"]]["source_index"]
        verifications.extend(parsed)
    accepted = sum(1 for item in verifications if item["is_damage"])
    print(f"[Qwen] accepted={accepted} rejected={len(verifications) - accepted}", flush=True)
    return {"status": "success", "model": os.getenv("QWEN_MODEL_ID", "Qwen/Qwen2.5-VL-3B-Instruct"), "failure_reason": None, "verifications": verifications, "inference_seconds": time.perf_counter() - overall_started}


@torch.inference_mode()
def detect_vehicle_bbox(image: np.ndarray) -> dict[str, Any]:
    """Run only KptNetV1's existing single-class YOLO detector as an input gate."""
    if state.kpt is None:
        raise HTTPException(status_code=503, detail="KptNetV1 vehicle detector is not loaded")
    height, width = image.shape[:2]
    tensor, ratio, left, top = letterbox(image)
    raw = state.kpt.jointnet(tensor.to(state.kpt.device))
    detections = non_max_suppression(raw, conf_thres=0.001, iou_thres=0.7, nc=1)[0]
    if len(detections) == 0:
        return {
            "success": False,
            "reason": "NO_VEHICLE_DETECTED",
            "bbox_xyxy": None,
            "confidence": None,
            "class_id": None,
        }
    index = int(detections[:, 4].argmax().item())
    bbox_lb = detections[index, :4].detach().float().cpu().numpy()
    bbox = to_original_xy(bbox_lb.reshape(2, 2), ratio, left, top, width, height).reshape(-1)
    bbox_values = [float(value) for value in bbox]
    confidence = float(detections[index, 4])
    passes_gate = vehicle_gate_passes(bbox_values, confidence)
    return {
        "success": passes_gate,
        "reason": None if passes_gate else "NO_VEHICLE_DETECTED",
        "bbox_xyxy": bbox_values,
        "confidence": confidence,
        "class_id": int(detections[index, 5]),
    }


def decode_image(data_url: str) -> np.ndarray:
    try:
        header, encoded = data_url.split(",", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="image_data must be a base64 data URL") from exc
    if header.lower() not in {
        "data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"
    }:
        raise HTTPException(status_code=415, detail="unsupported image type")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="invalid base64 image") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413 if raw else 400, detail="invalid image size")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="image decode failed")
    return image


@asynccontextmanager
async def lifespan(_app: FastAPI):
    started = time.perf_counter()
    landmarks_path = Path(os.getenv("ALTIS_LANDMARKS_PATH", PROJECT_ROOT / "ai_service" / "data" / "altis_30_landmarks.json"))
    metadata_path = KPTNET_ROOT / "metadata" / "keypoints.json"
    state.landmarks, state.landmark_validation = load_landmark_map(landmarks_path, metadata_path)
    state.kpt = KptNetV1(device="cpu")
    state.damage = YOLO(DAMAGENET_ROOT / "model.pt")
    load_qwen()
    state.load_seconds = time.perf_counter() - started
    yield


app = FastAPI(title="iRent Local AI Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    ready = state.kpt is not None and state.damage is not None
    return {
        "ok": ready,
        "device": "cpu",
        "models": {"kptnetv1": state.kpt is not None, "damagenetv1": state.damage is not None},
        "qwen_vlm": {
            "enabled": qwen_enabled(),
            "loaded": state.qwen_model is not None,
            "error": state.qwen_error,
            "device": state.qwen_device,
            "quantization": state.qwen_quantization,
        },
        "landmark_mapping": state.landmark_validation,
        "model_load_seconds": state.load_seconds,
    }


@app.post("/v1/kpt")
def predict_kpt(request: ImageRequest) -> dict[str, Any]:
    if state.kpt is None:
        raise HTTPException(status_code=503, detail="KptNetV1 is not loaded")
    image = decode_image(request.image_data)
    started = time.perf_counter()
    with kpt_lock:
        result = state.kpt.predict(image)
    result["inference_seconds"] = time.perf_counter() - started
    return result


@app.post("/v1/vehicle-gate")
def predict_vehicle_gate(request: ImageRequest) -> dict[str, Any]:
    image = decode_image(request.image_data)
    started = time.perf_counter()
    with kpt_lock:
        result = detect_vehicle_bbox(image)
    return {
        "schema_version": "vehicle-gate.v1",
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        **result,
        "inference_seconds": time.perf_counter() - started,
    }


@app.post("/v1/guidance")
def predict_guidance(request: ImageRequest) -> dict[str, Any]:
    if state.kpt is None or state.landmarks is None:
        raise HTTPException(status_code=503, detail="KptNetV1 guidance is not loaded")
    image = decode_image(request.image_data)
    started = time.perf_counter()
    with kpt_lock:
        kpt_result = state.kpt.predict(image)
    guidance = solve_guidance(kpt_result, state.landmarks, int(image.shape[1]), int(image.shape[0]))
    guidance["kpt"] = {
        "schema_version": kpt_result.get("schema_version"),
        "detection_confidence": kpt_result.get("detection_confidence"),
        "reliable_count": kpt_result.get("reliable_count", 0),
        "correction_applied_count": kpt_result.get("correction_applied_count", 0),
        "pnp_eligible": kpt_result.get("pnp_eligible", False),
    }
    guidance["landmark_mapping"] = state.landmark_validation
    guidance["inference_seconds"] = time.perf_counter() - started
    return guidance


@app.post("/v1/damage")
def predict_damage(request: ImageRequest) -> dict[str, Any]:
    if state.damage is None:
        raise HTTPException(status_code=503, detail="DamageNetV1 is not loaded")
    image = decode_image(request.image_data)
    started = time.perf_counter()
    with damage_lock:
        predictions = state.damage.predict(
            source=image, conf=0.15, iou=0.60, imgsz=640,
            save=False, verbose=False, device="cpu",
        )
    detections: list[dict[str, Any]] = []
    for box in predictions[0].boxes:
        label_id = int(box.cls.item())
        if label_id not in ALLOWED_LABELS:
            raise RuntimeError(f"unexpected DamageNet label id: {label_id}")
        detections.append({
            "label_id": label_id,
            "label": ALLOWED_LABELS[label_id],
            "confidence": float(box.conf.item()),
            "bbox_xyxy": [float(value) for value in box.xyxy[0].tolist()],
        })
    print(f"[DamageNet] candidates={len(detections)}", flush=True)
    try:
        vlm = verify_damage_candidates(image, detections)
    except TimeoutError:
        print(f"[Qwen] unavailable status=timeout candidates={len(detections)} reason=QWEN_TIMEOUT", flush=True)
        vlm = {"status": "timeout", "model": os.getenv("QWEN_MODEL_ID"), "failure_reason": "QWEN_TIMEOUT", "verifications": []}
    except ValueError as exc:
        print(f"[Qwen] unavailable status=failed candidates={len(detections)} reason=QWEN_RESPONSE_INVALID:{type(exc).__name__}", flush=True)
        vlm = {"status": "failed", "model": os.getenv("QWEN_MODEL_ID"), "failure_reason": f"QWEN_RESPONSE_INVALID:{type(exc).__name__}"[:120], "verifications": []}
    except Exception as exc:
        print(f"[Qwen] unavailable status=failed candidates={len(detections)} reason=QWEN_INFERENCE_FAILED:{type(exc).__name__}", flush=True)
        vlm = {"status": "failed", "model": os.getenv("QWEN_MODEL_ID"), "failure_reason": f"QWEN_INFERENCE_FAILED:{type(exc).__name__}"[:120], "verifications": []}
    return {
        "schema_version": "damagenetv1.output.v1",
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "detections": detections,
        "vlm": vlm,
        "inference_seconds": time.perf_counter() - started,
    }
