from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from guidance import build_approximate_intrinsics, load_landmark_map, solve_guidance


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+")
    parser.add_argument("--kptnet-root", required=True)
    parser.add_argument("--landmarks", default=str(Path(__file__).parent / "data" / "altis_30_landmarks.json"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    kpt_root = Path(args.kptnet_root).resolve()
    sys.path.insert(0, str(kpt_root))
    from kptnetv1 import KptNetV1

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    landmark_map, validation = load_landmark_map(Path(args.landmarks), kpt_root / "metadata" / "keypoints.json")
    model = KptNetV1(device="cpu")
    summary = {"landmark_mapping": validation, "images": []}
    for image_arg in args.images:
        image_path = Path(image_arg)
        image = cv2.imread(str(image_path))
        if image is None:
            raise RuntimeError(f"cannot read {image_path}")
        kpt = model.predict(image)
        guidance = solve_guidance(kpt, landmark_map, image.shape[1], image.shape[0])
        record = {"image": str(image_path), "kpt": {
            "detection_confidence": kpt.get("detection_confidence"), "reliable_count": kpt.get("reliable_count"),
            "correction_applied_count": kpt.get("correction_applied_count"), "pnp_eligible": kpt.get("pnp_eligible"),
        }, "guidance": guidance}
        summary["images"].append(record)
        (output / f"{image_path.stem}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        overlay = image.copy()
        if guidance.get("success"):
            matrix, distortion, _ = build_approximate_intrinsics(image.shape[1], image.shape[0])
            names = guidance["debug"]["correspondence_names"]
            obj = np.stack([landmark_map[name] for name in names])
            projected, _ = cv2.projectPoints(obj, np.array(guidance["rvec"]), np.array(guidance["tvec"]), matrix, distortion)
            actual = {p["name"]: p["final_xy"] for p in kpt["final_reliable_keypoints"]}
            inliers = set(guidance["debug"]["inlier_names"])
            for name, reprojection in zip(names, projected.reshape(-1, 2)):
                measured = tuple(round(v) for v in actual[name])
                predicted = tuple(round(float(v)) for v in reprojection)
                color = (40, 200, 40) if name in inliers else (20, 20, 230)
                cv2.circle(overlay, measured, 6, color, 2)
                cv2.drawMarker(overlay, predicted, (255, 80, 20), cv2.MARKER_CROSS, 12, 2)
                cv2.line(overlay, measured, predicted, color, 1)
        cv2.imwrite(str(output / f"{image_path.stem}-reprojection.jpg"), overlay)
    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
