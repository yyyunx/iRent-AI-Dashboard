from __future__ import annotations

import base64
import binascii
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parents[1]
IRENT_ROOT = PROJECT_ROOT.parents[1]
KPTNET_ROOT = Path(os.getenv("KPTNET_ROOT", IRENT_ROOT / "kptnetv1")).resolve()
DAMAGENET_ROOT = Path(os.getenv("DAMAGENET_ROOT", IRENT_ROOT / "damagenetv1")).resolve()
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_LABELS = {0: "Scratched", 1: "Dented", 2: "Broken"}

sys.path.insert(0, str(KPTNET_ROOT))
from kptnetv1 import KptNetV1  # noqa: E402
from guidance import LandmarkConfigurationError, load_landmark_map, solve_guidance  # noqa: E402


class ImageRequest(BaseModel):
    image_data: str


class ModelState:
    kpt: KptNetV1 | None = None
    damage: YOLO | None = None
    load_seconds: float | None = None
    landmarks: dict[str, np.ndarray] | None = None
    landmark_validation: dict[str, Any] | None = None


state = ModelState()
kpt_lock = threading.Lock()
damage_lock = threading.Lock()


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
    return {
        "schema_version": "damagenetv1.output.v1",
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "detections": detections,
        "inference_seconds": time.perf_counter() - started,
    }
