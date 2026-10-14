from __future__ import annotations

import json
import itertools
import math
import os
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np


class LandmarkConfigurationError(RuntimeError):
    """The immutable 2D/3D name contract is invalid."""


def _finite_vector(values: Any, length: int) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float64).reshape(-1)
    if vector.size != length or not np.isfinite(vector).all():
        raise ValueError(f"expected {length} finite values")
    return vector


def load_landmark_map(landmarks_path: Path, metadata_path: Path) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
    landmarks_doc = json.loads(landmarks_path.read_text(encoding="utf-8"))
    metadata_doc = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata_names = [str(name) for name in metadata_doc.get("keypoint_names", [])]
    landmark_rows = landmarks_doc.get("keypoints", [])
    landmark_names = [str(row.get("name", "")) for row in landmark_rows]

    metadata_duplicates = sorted(name for name, count in Counter(metadata_names).items() if count > 1)
    landmark_duplicates = sorted(name for name, count in Counter(landmark_names).items() if count > 1)
    missing = sorted(set(metadata_names) - set(landmark_names))
    extra = sorted(set(landmark_names) - set(metadata_names))
    declared_count = landmarks_doc.get("count")
    valid = (
        len(metadata_names) == 30
        and declared_count == 30
        and len(landmark_rows) == 30
        and not metadata_duplicates
        and not landmark_duplicates
        and not missing
        and not extra
    )
    validation = {
        "valid": valid,
        "metadata_count": len(metadata_names),
        "landmark_declared_count": declared_count,
        "landmark_actual_count": len(landmark_rows),
        "metadata_duplicates": metadata_duplicates,
        "landmark_duplicates": landmark_duplicates,
        "missing_in_landmarks": missing,
        "extra_in_landmarks": extra,
        "mapping_strategy": "exact keypoint name; array indices are ignored",
    }
    if not valid:
        raise LandmarkConfigurationError(f"KptNet/Altis landmark mapping is invalid: {validation}")

    mapping = {row["name"]: _finite_vector(row["xyz_world"], 3) for row in landmark_rows}
    return mapping, validation


def build_approximate_intrinsics(width: int, height: int) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    focal_scale = float(os.getenv("PNP_NORMALIZED_FOCAL", "1.2"))
    if not math.isfinite(focal_scale) or focal_scale <= 0:
        raise ValueError("PNP_NORMALIZED_FOCAL must be finite and positive")
    focal_px = focal_scale * max(width, height)
    matrix = np.array(
        [[focal_px, 0.0, width / 2.0], [0.0, focal_px, height / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    distortion = np.zeros((5, 1), dtype=np.float64)
    horizontal_fov = math.degrees(2.0 * math.atan(width / (2.0 * focal_px)))
    return matrix, distortion, {
        "strategy": "configurable_approximation",
        "calibrated": False,
        "normalized_focal": focal_scale,
        "focal_length_px": focal_px,
        "principal_point_px": [width / 2.0, height / 2.0],
        "estimated_horizontal_fov_degrees": horizontal_fov,
        "distortion_model": "zero_5_coefficients",
        "assumptions": [
            "fx equals fy",
            "principal point is the image center",
            "lens distortion is zero",
            "pose scale follows the source Blender scene units (metric scale_length=1)",
        ],
    }


def blender_to_three(vector: np.ndarray) -> np.ndarray:
    """Right-handed Blender (X right/left, Y longitudinal, Z up) -> Three.js Y-up: (X, Z, -Y)."""
    x, y, z = _finite_vector(vector, 3)
    return np.array([x, z, -y], dtype=np.float64)


VIEW_SECTORS = (
    "FRONT", "FRONT_LEFT", "LEFT", "REAR_LEFT",
    "REAR", "REAR_RIGHT", "RIGHT", "FRONT_RIGHT",
)


def yaw_to_view_sector(yaw: float) -> str:
    """Map car-frame yaw to one of eight 45-degree semantic view sectors.

    yaw=0 faces the vehicle front (-Y); positive yaw moves toward vehicle left
    (+X). Boundaries are half-open, so +22.5 belongs to FRONT_LEFT while
    -22.5 belongs to FRONT_RIGHT.
    """
    normalized = ((float(yaw) + 180.0) % 360.0) - 180.0
    direction = -1 if normalized < 0 else 1
    index = direction * int(math.floor((abs(normalized) + 22.5) / 45.0)) % 8
    return VIEW_SECTORS[index]


def pose_to_viewer(rvec: np.ndarray, tvec: np.ndarray, object_center: np.ndarray) -> dict[str, Any]:
    rotation_object_to_camera, _ = cv2.Rodrigues(rvec)
    rotation_camera_to_object = rotation_object_to_camera.T
    camera_position = (-rotation_camera_to_object @ tvec.reshape(3, 1)).reshape(3)
    center = _finite_vector(object_center, 3)
    relative = camera_position - center
    distance = float(np.linalg.norm(relative))
    if not math.isfinite(distance) or distance <= 0:
        raise ValueError("camera distance is not positive and finite")

    # OpenCV camera axes are +X right, +Y down, +Z forward. Convert the camera's
    # up vector into Blender world space, then into Three.js space.
    camera_up_blender = rotation_camera_to_object @ np.array([0.0, -1.0, 0.0])
    three_relative = blender_to_three(relative)
    three_camera_position = blender_to_three(camera_position)
    three_target = blender_to_three(center)
    three_up = blender_to_three(camera_up_blender)
    direction = three_relative / np.linalg.norm(three_relative)
    up = three_up / np.linalg.norm(three_up)

    horizontal = math.hypot(relative[0], relative[1])
    yaw = math.degrees(math.atan2(relative[0], -relative[1]))
    pitch = math.degrees(math.atan2(relative[2], horizontal))
    forward_to_target = (center - camera_position) / distance
    nominal_right = np.cross(forward_to_target, np.array([0.0, 0.0, 1.0]))
    if np.linalg.norm(nominal_right) > 1e-9:
        nominal_right /= np.linalg.norm(nominal_right)
        nominal_up = np.cross(nominal_right, forward_to_target)
        roll = math.degrees(math.atan2(np.dot(camera_up_blender, nominal_right), np.dot(camera_up_blender, nominal_up)))
    else:
        roll = 0.0

    return {
        "camera_position_car_frame": camera_position.tolist(),
        "yaw": float(yaw),
        "pitch": float(pitch),
        "roll": float(roll),
        "distance": distance,
        "viewer_pose": {
            "coordinate_frame": "Three.js right-handed Y-up",
            "camera_direction_from_target": direction.tolist(),
            "camera_up": up.tolist(),
            "target_car_frame_blender": center.tolist(),
            "axis_conversion": "(X_three, Y_three, Z_three) = (X_blender, Z_blender, -Y_blender)",
        },
        "pose_debug": {
            "rotation_object_to_camera": rotation_object_to_camera.tolist(),
            "rotation_camera_to_object": rotation_camera_to_object.tolist(),
            "camera_center_car_frame": camera_position.tolist(),
            "camera_position_three": three_camera_position.tolist(),
            "target_three": three_target.tolist(),
            "camera_forward_three": (-direction).tolist(),
            "camera_up_three": up.tolist(),
        },
    }


def structured_failure(reason: str, count: int, intrinsics: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schema_version": "altis-guidance.v1",
        "success": False,
        "failure_reason": reason,
        "correspondence_count": count,
        "inlier_count": 0,
        "inlier_ratio": 0.0,
        "reprojection_error": None,
        "intrinsics": intrinsics,
        "guidance_status": "UNAVAILABLE",
        "solver_used": "NONE",
        "validation_result": {"valid": False, "reasons": [reason]},
        "degradation_reason": reason,
        "view_sector": None,
        "covered_sectors": [],
    }


def _semantic_axes(names: list[str]) -> tuple[int, int]:
    """Return dominant longitudinal/side votes from immutable landmark names.

    Longitudinal vote is -1 for front and +1 for rear; side vote follows the
    Blender landmark X axis (+1 left, -1 right). A zero vote means ambiguous,
    so no hemisphere is imposed for that axis.
    """
    longitudinal = 0
    side = 0
    for name in names:
        if name == "LOGO_FRONT" or any(token in name for token in ("_FL", "_FR")):
            longitudinal -= 1
        elif name == "LOGO_REAR" or any(token in name for token in ("_RL", "_RR")):
            longitudinal += 1
        if name == "MIRROR_L" or name.endswith(("_FL", "_RL", "_L")):
            side += 1
        elif name == "MIRROR_R" or name.endswith(("_FR", "_RR", "_R")):
            side -= 1
    return int(np.sign(longitudinal)), int(np.sign(side))


def _evaluate_pose(
    rvec: np.ndarray,
    tvec: np.ndarray,
    obj: np.ndarray,
    img: np.ndarray,
    names: list[str],
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    landmark_map: dict[str, np.ndarray],
    reprojection_threshold: float,
) -> dict[str, Any]:
    rotation, _ = cv2.Rodrigues(rvec)
    projected, _ = cv2.projectPoints(obj, rvec, tvec, camera_matrix, distortion)
    residuals = np.linalg.norm(projected.reshape(-1, 2) - img, axis=1)
    inlier_indices = np.flatnonzero(residuals <= reprojection_threshold)
    support_error = (
        float(np.sqrt(np.mean(np.square(residuals[inlier_indices]))))
        if inlier_indices.size else math.inf
    )
    all_landmarks = np.stack(list(landmark_map.values()))
    object_center = np.mean(all_landmarks, axis=0)
    camera_position = (-rotation.T @ tvec.reshape(3, 1)).reshape(3)
    camera_to_center = object_center - camera_position
    distance = float(np.linalg.norm(camera_to_center))
    camera_forward = rotation.T @ np.array([0.0, 0.0, 1.0])
    forward_alignment = (
        float(np.dot(camera_forward, camera_to_center / distance))
        if math.isfinite(distance) and distance > 0 else -1.0
    )
    depths = (rotation @ obj.T + tvec.reshape(3, 1))[2]
    positive_depth_fraction = float(np.mean(depths > 0))
    bounds_min = np.min(all_landmarks, axis=0)
    bounds_max = np.max(all_landmarks, axis=0)
    camera_inside_vehicle = bool(np.all((camera_position >= bounds_min) & (camera_position <= bounds_max)))
    bounding_radius = float(np.max(np.linalg.norm(all_landmarks - object_center, axis=1)))
    support_names = [names[index] for index in inlier_indices]
    longitudinal_vote, side_vote = _semantic_axes(support_names)
    relative = camera_position - object_center
    hemisphere_consistent = bool(
        (longitudinal_vote == 0 or relative[1] * longitudinal_vote > 0)
        and (side_vote == 0 or relative[0] * side_vote > 0)
    )

    reasons: list[str] = []
    if not np.isfinite(rvec).all() or not np.isfinite(tvec).all() or not np.isfinite(rotation).all():
        reasons.append("NONFINITE_POSE")
    if inlier_indices.size < 4:
        reasons.append("INSUFFICIENT_INLIERS")
    if not math.isfinite(support_error) or support_error > reprojection_threshold:
        reasons.append("REPROJECTION_INCONSISTENT")
    if positive_depth_fraction < 0.75:
        reasons.append("CHEIRALITY_FAILURE")
    if camera_inside_vehicle or not math.isfinite(distance) or distance <= bounding_radius:
        reasons.append("CAMERA_INSIDE_OR_TOO_CLOSE")
    if forward_alignment <= 0:
        reasons.append("CAMERA_FACING_AWAY")
    if camera_position[2] <= bounds_min[2]:
        reasons.append("CAMERA_BELOW_VEHICLE")
    if not hemisphere_consistent:
        reasons.append("LANDMARK_HEMISPHERE_MISMATCH")

    return {
        "valid": not reasons,
        "reasons": reasons,
        "inlier_indices": inlier_indices,
        "residuals": residuals,
        "reprojection_error": support_error,
        "positive_depth_fraction": positive_depth_fraction,
        "camera_inside_vehicle": camera_inside_vehicle,
        "camera_distance": distance,
        "vehicle_bounding_radius": bounding_radius,
        "forward_alignment": forward_alignment,
        "semantic_longitudinal_vote": longitudinal_vote,
        "semantic_side_vote": side_vote,
        "hemisphere_consistent": hemisphere_consistent,
    }


def _refine_candidate(
    rvec: np.ndarray,
    tvec: np.ndarray,
    obj: np.ndarray,
    img: np.ndarray,
    names: list[str],
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    landmark_map: dict[str, np.ndarray],
    threshold: float,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    validation = _evaluate_pose(rvec, tvec, obj, img, names, camera_matrix, distortion, landmark_map, threshold)
    indices = validation["inlier_indices"]
    if indices.size >= 4 and hasattr(cv2, "solvePnPRefineLM"):
        try:
            rvec, tvec = cv2.solvePnPRefineLM(obj[indices], img[indices], camera_matrix, distortion, rvec, tvec)
        except cv2.error:
            pass
        validation = _evaluate_pose(rvec, tvec, obj, img, names, camera_matrix, distortion, landmark_map, threshold)
    return rvec, tvec, validation


def _ransac_candidate(
    obj: np.ndarray,
    img: np.ndarray,
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    threshold: float,
    iterations: int,
    flag: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    try:
        success, rvec, tvec, inliers = cv2.solvePnPRansac(
            obj, img, camera_matrix, distortion,
            iterationsCount=iterations, reprojectionError=threshold,
            confidence=0.99, flags=flag,
        )
    except cv2.error:
        return None
    if not success or rvec is None or tvec is None or inliers is None or len(inliers) < 4:
        return None
    return rvec, tvec, inliers.reshape(-1)


def _ap3p_candidates(
    obj: np.ndarray,
    img: np.ndarray,
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    threshold: float,
    iterations: int,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Enumerate AP3P roots from the RANSAC-supported four-point subsets.

    RANSAC first identifies a consensus set. OpenCV's generic AP3P API can then
    return every algebraic root for each four-point subset; selection happens
    only after structural validation and full-correspondence support scoring.
    """
    seed = _ransac_candidate(obj, img, camera_matrix, distortion, threshold, iterations, cv2.SOLVEPNP_AP3P)
    if seed is None:
        return []
    seed_rvec, seed_tvec, seed_inliers = seed
    candidates: list[tuple[np.ndarray, np.ndarray]] = [(seed_rvec, seed_tvec)]
    for subset in itertools.combinations(seed_inliers.tolist(), 4):
        indices = np.asarray(subset, dtype=np.int32)
        try:
            solved = cv2.solvePnPGeneric(
                obj[indices], img[indices], camera_matrix, distortion, flags=cv2.SOLVEPNP_AP3P
            )
        except cv2.error:
            continue
        if solved[0]:
            candidates.extend((rvec, tvec) for rvec, tvec in zip(solved[1], solved[2]))
    return candidates


def solve_guidance(
    kpt_result: dict[str, Any], landmark_map: dict[str, np.ndarray], image_width: int, image_height: int
) -> dict[str, Any]:
    camera_matrix, distortion, intrinsics = build_approximate_intrinsics(image_width, image_height)
    reliable = kpt_result.get("final_reliable_keypoints", [])
    seen: set[str] = set()
    object_points: list[np.ndarray] = []
    image_points: list[np.ndarray] = []
    names: list[str] = []
    for point in reliable if isinstance(reliable, list) else []:
        name = str(point.get("name", ""))
        if not name or name in seen:
            return structured_failure("DUPLICATE_OR_EMPTY_RELIABLE_KEYPOINT_NAME", len(object_points), intrinsics)
        if name not in landmark_map:
            return structured_failure(f"UNKNOWN_RELIABLE_KEYPOINT_NAME:{name}", len(object_points), intrinsics)
        try:
            xy = _finite_vector(point.get("final_xy"), 2)
        except (TypeError, ValueError):
            return structured_failure(f"INVALID_2D_KEYPOINT:{name}", len(object_points), intrinsics)
        seen.add(name)
        names.append(name)
        object_points.append(landmark_map[name])
        image_points.append(xy)

    count = len(object_points)
    if count < 4:
        return structured_failure("INSUFFICIENT_RELIABLE_KEYPOINTS", count, intrinsics)
    obj = np.asarray(object_points, dtype=np.float64)
    img = np.asarray(image_points, dtype=np.float64)
    if np.linalg.matrix_rank(obj - obj.mean(axis=0)) < 2:
        return structured_failure("DEGENERATE_3D_GEOMETRY", count, intrinsics)

    threshold = float(os.getenv("PNP_RANSAC_REPROJECTION_PX", "12"))
    iterations = int(os.getenv("PNP_RANSAC_ITERATIONS", "200"))
    selected: tuple[np.ndarray, np.ndarray, dict[str, Any]] | None = None
    solver_used = "NONE"
    primary = _ransac_candidate(obj, img, camera_matrix, distortion, threshold, iterations, cv2.SOLVEPNP_EPNP)
    if primary is not None:
        rvec, tvec, _ = primary
        rvec, tvec, validation = _refine_candidate(
            rvec, tvec, obj, img, names, camera_matrix, distortion, landmark_map, threshold
        )
        if validation["valid"]:
            selected = (rvec, tvec, validation)
            solver_used = "EPNP"

    if selected is None:
        valid_candidates: list[tuple[np.ndarray, np.ndarray, dict[str, Any]]] = []
        for candidate_rvec, candidate_tvec in _ap3p_candidates(
            obj, img, camera_matrix, distortion, threshold, iterations
        ):
            candidate_rvec, candidate_tvec, validation = _refine_candidate(
                candidate_rvec, candidate_tvec, obj, img, names,
                camera_matrix, distortion, landmark_map, threshold,
            )
            if validation["valid"]:
                valid_candidates.append((candidate_rvec, candidate_tvec, validation))
        if valid_candidates:
            # Prefer corroboration beyond the minimal set, then the pose that most
            # directly faces the vehicle, and finally lower inlier reprojection RMS.
            selected = max(
                valid_candidates,
                key=lambda item: (
                    int(item[2]["inlier_indices"].size),
                    float(item[2]["forward_alignment"]),
                    -float(item[2]["reprojection_error"]),
                ),
            )
            solver_used = "AP3P"

    if selected is None:
        return structured_failure("PNP_NO_VALID_SOLUTION", count, intrinsics)

    rvec, tvec, validation = selected
    inlier_indices = validation["inlier_indices"]
    residuals = validation["residuals"]
    inlier_error = float(validation["reprojection_error"])
    try:
        pose = pose_to_viewer(rvec, tvec, np.mean(np.stack(list(landmark_map.values())), axis=0))
    except ValueError:
        return structured_failure("PNP_INVALID_CAMERA_POSE", count, intrinsics)

    guidance_status = "DEGRADED" if solver_used == "AP3P" and inlier_indices.size == 4 else "FULL"
    degradation_reason = "AP3P_MINIMAL_FOUR_POINT_SUPPORT" if guidance_status == "DEGRADED" else None
    validation_public = {
        "valid": True,
        "reasons": [],
        "positive_depth_fraction": validation["positive_depth_fraction"],
        "camera_inside_vehicle": validation["camera_inside_vehicle"],
        "forward_alignment": validation["forward_alignment"],
        "hemisphere_consistent": validation["hemisphere_consistent"],
        "minimal_support_only": bool(inlier_indices.size == 4),
    }
    view_sector = yaw_to_view_sector(pose["yaw"])
    return {
        "schema_version": "altis-guidance.v1",
        "success": True,
        "failure_reason": None,
        "correspondence_count": count,
        "inlier_count": int(inlier_indices.size),
        "inlier_ratio": float(inlier_indices.size / count),
        "reprojection_error": inlier_error,
        "guidance_status": guidance_status,
        "solver_used": solver_used,
        "validation_result": validation_public,
        "degradation_reason": degradation_reason,
        "view_sector": view_sector,
        # A single conservative semantic sector is credited for both FULL and
        # DEGRADED. DEGRADED never derives coverage from pitch or distance.
        "covered_sectors": [view_sector],
        "rvec": rvec.reshape(3).tolist(),
        "tvec": tvec.reshape(3).tolist(),
        **pose,
        "intrinsics": intrinsics,
        "debug": {
            "correspondence_names": names,
            "inlier_names": [names[index] for index in inlier_indices],
            "reprojection_errors_px": {name: float(error) for name, error in zip(names, residuals)},
            "ransac_reprojection_threshold_px": threshold,
            "solver_priority": ["EPNP", "AP3P"],
            "opencv_camera_axes": "+X right, +Y down, +Z forward",
            "landmark_axes": "Blender right-handed Z-up; front is predominantly -Y",
        },
    }
