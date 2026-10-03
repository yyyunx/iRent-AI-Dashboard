# iRent local AI service

This adapter loads the frozen KptNetV1 and DamageNetV1 packages once at process startup and serves them on localhost. It does not alter either model's checkpoints, thresholds, or inference behavior.

From the project root in PowerShell:

```powershell
$env:KPTNET_ROOT = 'C:\Users\CSIE\Desktop\irent\kptnetv1'
$env:DAMAGENET_ROOT = 'C:\Users\CSIE\Desktop\irent\damagenetv1'
& 'D:\GPT_workspace\pythondev.venv\Scripts\python.exe' -m pip install -r .\ai_service\requirements.txt
& 'D:\GPT_workspace\pythondev.venv\Scripts\python.exe' -m uvicorn app:app --app-dir .\ai_service --host 127.0.0.1 --port 8000
```

The Node backend is the only intended caller. Endpoints accept JSON containing an image data URL:

```json
{"image_data":"data:image/jpeg;base64,..."}
```

- `GET /health`
- `POST /v1/kpt`
- `POST /v1/guidance` — frozen KptNetV1 followed by name-based Altis PnP
- `POST /v1/damage`

## Guidance pose contract

`/v1/guidance` uses only `final_reliable_keypoints` and joins them to `data/altis_30_landmarks.json` by exact landmark name. Startup fails if the KptNet metadata and landmark file are not a unique 30/30 set match. Fewer than four points, degenerate geometry, insufficient RANSAC inliers, solver errors, or non-finite pose values produce `success: false` with a `failure_reason`; no placeholder pose is returned.

The camera is not calibrated. By default `fx=fy=1.2*max(width,height)`, the principal point is the image center, and distortion is zero. Configure the focal approximation with `PNP_NORMALIZED_FOCAL`; configure RANSAC with `PNP_RANSAC_REPROJECTION_PX` and `PNP_RANSAC_ITERATIONS`. Every response repeats these assumptions under `intrinsics` and sets `calibrated: false`.

Landmarks use Blender's right-handed Z-up frame. OpenCV PnP returns an object-to-camera transform in the OpenCV camera frame (`+X right, +Y down, +Z forward`). Camera position in the car frame is `C=-R^T t`. Viewer vectors are converted to Three.js right-handed Y-up using `(X_three,Y_three,Z_three)=(X_blender,Z_blender,-Y_blender)`. `yaw` is the camera azimuth around the car's Z axis, with 0° at the front (`-Y`); `pitch` is elevation above the ground plane; `roll` is camera-up rotation about the viewing direction. The frontend consumes the viewer direction/up vectors, not OpenCV Euler angles.
