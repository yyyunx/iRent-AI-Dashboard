# iRent local AI service

This adapter loads the frozen KptNetV1 and DamageNetV1 packages once at process startup and serves them on localhost. It does not alter either model's checkpoints, thresholds, or inference behavior.

Prerequisites: Python 3.11 and the external frozen KptNetV1/DamageNetV1 packages.
The packages and their weights are not included in this public repository. Use
your own absolute paths below; Node dependencies do not install these models.

From the project root in a separate PowerShell terminal (for a new checkout):

```powershell
python -m venv .venv
$env:KPTNET_ROOT = 'C:\models\kptnetv1'
$env:DAMAGENET_ROOT = 'C:\models\damagenetv1'
.\.venv\Scripts\python.exe -m pip install -r .\ai_service\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir .\ai_service --host 127.0.0.1 --port 8000
```

Reuse an existing virtual environment if you already have one. For CUDA/Qwen,
install the PyTorch build appropriate to your GPU environment before starting
the service. The supplied AI Dockerfile installs CPU PyTorch.

The Node backend is the only intended caller. Endpoints accept JSON containing an image data URL:

```json
{"image_data":"data:image/jpeg;base64,..."}
```

- `GET /health`
- `POST /v1/kpt`
- `POST /v1/guidance` — frozen KptNetV1 followed by name-based Altis PnP
- `POST /v1/vehicle-gate` — KptNetV1's existing single-class YOLO bbox detection only
- `POST /v1/damage`

## Vehicle input gate threshold

KptNetV1's internal detector keeps its existing `conf_thres=0.001` behavior. The
deployment-only Vehicle Input Gate applies a separate
`VEHICLE_GATE_CONF_THRESHOLD=0.50` to the selected highest-confidence bbox. A
missing bbox or selected confidence below `0.50` returns
`NO_VEHICLE_DETECTED` before downstream inference.

This value comes from the final sampled gate evaluation, not a formal benchmark: 100
vehicle images and 14 non-vehicle images produced 100 TP, 0 FN, 0 FP, and 14 TN at
`0.50`; the maximum negative confidence was `0.242827` and the minimum positive
confidence was `0.88`.

## DamageNet → pretrained Qwen VLM

`/v1/damage` always runs the frozen DamageNet checkpoint first. With no candidates,
Qwen is skipped. Otherwise, when `QWEN_VLM_ENABLED=true`, the original image,
bounded candidate crops, and bbox/label metadata go to the pretrained
`Qwen/Qwen2.5-VL-3B-Instruct` model. This repository contains no fine-tuning, LoRA,
additional classifier, or VLM training path.

The default `QWEN_STRUCTURED_JSON_VERSION=v3` uses the benchmarked recall-oriented
prompt and returns one `damage_type` per candidate; the adapter derives
`is_damage = (damage_type != "none")` and preserves the existing verification shape.
Set `QWEN_STRUCTURED_JSON_VERSION=legacy` to roll back to the previous Structured
JSON prompt/parser. Raw high-recall DamageNet
candidates remain available for audit, but only `is_damage=true` candidates become
final damage events. Timeout, malformed output, missing dependencies, disabled Qwen,
or load/inference failure yields an explicit unavailable per-photo result and no
final damage event. Submission waits for terminal per-photo analysis results;
missing or in-flight results return `409 ANALYSIS_PENDING`. Any unavailable photo
makes the submission `review_required`, while confirmed damage in other photos
still creates an incident. Inspect `damageSummary` and individual persisted
`damage` results for details. Submitted photos cannot be re-analyzed.

GPU deployment is recommended. The current Node-only Render/Docker service does not
launch this Python service and its free CPU plan is unsuitable for a 3B VLM. Deploy
`ai_service` separately on a GPU host, pre-cache or permit the initial pretrained
download, set `AI_SERVICE_URL`, and keep `AI_SERVICE_TIMEOUT_MS` above
`QWEN_TIMEOUT_SECONDS`.

For a local end-to-end check, set `QWEN_VLM_ENABLED=true`, `QWEN_DEVICE=cuda`, `QWEN_QUANTIZATION=4bit`, and
`QWEN_BATCH_SIZE=1` (or use `QWEN_DEVICE=cpu` for a slow fallback smoke test),
and the other `QWEN_*` values on the Python service. Set them before starting
uvicorn; this adapter does not automatically load a `.env` file.
`CONDITION_CHECK_ENABLED` in Node is currently UI state and does not enable or
disable the condition endpoint. Start Python first, then follow the Web
environment/account setup in the [root README](../README.md) and run `pnpm dev`
from the project root. Upload one vehicle photo in the customer
flow; the saved `/api/photos/condition-check` result contains raw `detections`, the
top-level `vlm` status, and only Qwen-approved `events`. The first model start may
download the public pretrained weights from Hugging Face; no token is hard-coded.

`GET /health` reports `ok` for KptNet/DamageNet readiness independently of Qwen.
Check `qwen_vlm.enabled`, `qwen_vlm.loaded`, and `qwen_vlm.error` separately. The
default Compose AI container does not forward `QWEN_*` settings, so setting them
only in Compose's root `.env` will not enable Qwen in that container.

On a 4 GB GPU, keep `QWEN_MAX_PIXELS` at or below `401408`. Run a one-candidate
GPU check from `ai_service` with:

```powershell
..\.venv\Scripts\python.exe .\benchmark_qwen.py 'C:\path\to\vehicle.jpg'
```

## Guidance pose contract

`/v1/guidance` uses only `final_reliable_keypoints` and joins them to `data/altis_30_landmarks.json` by exact landmark name. Startup fails if the KptNet metadata and landmark file are not a unique 30/30 set match. Fewer than four points, degenerate geometry, insufficient RANSAC inliers, solver errors, or non-finite pose values produce `success: false` with a `failure_reason`; no placeholder pose is returned.

The camera is not calibrated. By default `fx=fy=1.2*max(width,height)`, the principal point is the image center, and distortion is zero. Configure the focal approximation with `PNP_NORMALIZED_FOCAL`; configure RANSAC with `PNP_RANSAC_REPROJECTION_PX` and `PNP_RANSAC_ITERATIONS`. Every response repeats these assumptions under `intrinsics` and sets `calibrated: false`.

Landmarks use Blender's right-handed Z-up frame. OpenCV PnP returns an object-to-camera transform in the OpenCV camera frame (`+X right, +Y down, +Z forward`). Camera position in the car frame is `C=-R^T t`. Viewer vectors are converted to Three.js right-handed Y-up using `(X_three,Y_three,Z_three)=(X_blender,Z_blender,-Y_blender)`. `yaw` is the camera azimuth around the car's Z axis, with 0° at the front (`-Y`); `pitch` is elevation above the ground plane; `roll` is camera-up rotation about the viewing direction. The frontend consumes the viewer direction/up vectors, not OpenCV Euler angles.
