from __future__ import annotations

import math
import sys
from unittest.mock import patch
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import guidance
from guidance import blender_to_three, build_approximate_intrinsics, pose_to_viewer, solve_guidance, yaw_to_view_sector


def test_yaw_sector_boundaries_follow_car_frame_convention() -> None:
    assert yaw_to_view_sector(0) == "FRONT"
    assert yaw_to_view_sector(22.499) == "FRONT"
    assert yaw_to_view_sector(22.5) == "FRONT_LEFT"
    assert yaw_to_view_sector(90) == "LEFT"
    assert yaw_to_view_sector(-22.5) == "FRONT_RIGHT"
    assert yaw_to_view_sector(-90) == "RIGHT"
    assert yaw_to_view_sector(179.999) == "REAR"
    assert yaw_to_view_sector(-180) == "REAR"


def test_blender_to_three_is_right_handed_y_up() -> None:
    assert np.allclose(blender_to_three(np.array([1.0, 2.0, 3.0])), [1.0, 3.0, -2.0])
    x = blender_to_three(np.array([1.0, 0.0, 0.0]))
    y = blender_to_three(np.array([0.0, 1.0, 0.0]))
    z = blender_to_three(np.array([0.0, 0.0, 1.0]))
    assert np.allclose(np.cross(x, y), z)


def test_synthetic_pose_recovery_and_name_mapping() -> None:
    landmarks = {
        "a": np.array([-2.0, -3.0, 0.0]), "b": np.array([2.0, -3.0, 0.4]),
        "c": np.array([-2.2, 3.0, 0.2]), "d": np.array([2.1, 3.2, 0.6]),
        "e": np.array([-1.0, 0.0, 2.0]), "f": np.array([1.2, 0.5, 2.5]),
        "g": np.array([0.0, -1.0, 3.0]), "h": np.array([0.5, 2.0, 3.2]),
    }
    width, height = 1280, 720
    matrix, distortion, _ = build_approximate_intrinsics(width, height)
    obj = np.stack(list(landmarks.values()))
    center = np.mean(obj, axis=0)
    camera = center + np.array([3.0, -12.0, 6.0])
    forward = (center - camera) / np.linalg.norm(center - camera)
    right = np.cross(forward, np.array([0.0, 0.0, 1.0])); right /= np.linalg.norm(right)
    down = -np.cross(right, forward)
    rotation = np.stack([right, down, forward])
    expected_rvec, _ = cv2.Rodrigues(rotation)
    expected_tvec = -rotation @ camera
    projected, _ = cv2.projectPoints(obj, expected_rvec, expected_tvec, matrix, distortion)
    points = [
        {"name": name, "final_xy": xy.tolist()}
        for name, xy in reversed(list(zip(landmarks.keys(), projected.reshape(-1, 2))))
    ]
    result = solve_guidance({"final_reliable_keypoints": points}, landmarks, width, height)
    assert result["success"] is True
    assert result["guidance_status"] == "FULL"
    assert result["solver_used"] == "EPNP"
    assert result["covered_sectors"] == [result["view_sector"]]
    assert result["correspondence_count"] == 8
    assert result["inlier_count"] == 8
    assert result["reprojection_error"] < 1e-3
    assert math.isfinite(result["distance"]) and result["distance"] > 0
    assert np.isfinite(result["viewer_pose"]["camera_direction_from_target"]).all()


def test_viewer_elevation_tracks_pnp_camera_height() -> None:
    """The renderer direction must not collapse different PnP elevations to a fixed height."""
    center = np.zeros(3, dtype=np.float64)

    def pose_for_camera(camera_center: np.ndarray) -> dict:
        forward = -camera_center / np.linalg.norm(camera_center)
        right = np.cross(forward, np.array([0.0, 0.0, 1.0]))
        right /= np.linalg.norm(right)
        down = -np.cross(right, forward)
        rotation_object_to_camera = np.stack([right, down, forward])
        rvec, _ = cv2.Rodrigues(rotation_object_to_camera)
        tvec = -rotation_object_to_camera @ camera_center
        return pose_to_viewer(rvec, tvec, center)

    low = pose_for_camera(np.array([3.0, -8.0, 1.0]))
    high = pose_for_camera(np.array([3.0, -8.0, 5.0]))

    assert low["pitch"] < high["pitch"]
    assert low["viewer_pose"]["camera_direction_from_target"][1] < high["viewer_pose"]["camera_direction_from_target"][1]
    assert np.allclose(low["pose_debug"]["camera_forward_three"], -np.asarray(low["viewer_pose"]["camera_direction_from_target"]))


def test_fewer_than_four_points_is_structured_failure() -> None:
    landmarks = {name: np.array([index, index % 2, index % 3], dtype=float) for index, name in enumerate("abcd")}
    points = [{"name": name, "final_xy": [10.0, 20.0]} for name in "abc"]
    result = solve_guidance({"final_reliable_keypoints": points}, landmarks, 640, 480)
    assert result["success"] is False
    assert result["failure_reason"] == "INSUFFICIENT_RELIABLE_KEYPOINTS"
    assert result["correspondence_count"] == 3
    assert result["guidance_status"] == "UNAVAILABLE"
    assert result["solver_used"] == "NONE"
    assert result["view_sector"] is None
    assert result["covered_sectors"] == []


def _synthetic_correspondences(count: int = 8) -> tuple[dict[str, np.ndarray], list[dict], int, int]:
    base = {
        "a": np.array([-2.0, -3.0, 0.0]), "b": np.array([2.0, -3.0, 0.4]),
        "c": np.array([-2.2, 3.0, 0.2]), "d": np.array([2.1, 3.2, 0.6]),
        "e": np.array([-1.0, 0.0, 2.0]), "f": np.array([1.2, 0.5, 2.5]),
        "g": np.array([0.0, -1.0, 3.0]), "h": np.array([0.5, 2.0, 3.2]),
    }
    landmarks = dict(list(base.items())[:count])
    width, height = 1280, 720
    matrix, distortion, _ = build_approximate_intrinsics(width, height)
    obj = np.stack(list(landmarks.values()))
    center = np.mean(obj, axis=0)
    camera = center + np.array([3.0, -12.0, 6.0])
    forward = (center - camera) / np.linalg.norm(center - camera)
    right = np.cross(forward, np.array([0.0, 0.0, 1.0])); right /= np.linalg.norm(right)
    down = -np.cross(right, forward)
    rotation = np.stack([right, down, forward])
    rvec, _ = cv2.Rodrigues(rotation)
    tvec = -rotation @ camera
    projected, _ = cv2.projectPoints(obj, rvec, tvec, matrix, distortion)
    points = [{"name": name, "final_xy": xy.tolist()} for name, xy in zip(landmarks, projected.reshape(-1, 2))]
    return landmarks, points, width, height


def _force_epnp_failure(obj, img, camera_matrix, distortion, threshold, iterations, flag):
    if flag == cv2.SOLVEPNP_EPNP:
        return None
    return _ORIGINAL_RANSAC(obj, img, camera_matrix, distortion, threshold, iterations, flag)


_ORIGINAL_RANSAC = guidance._ransac_candidate


def test_epnp_failure_valid_ap3p_with_extra_support_is_full() -> None:
    landmarks, points, width, height = _synthetic_correspondences(6)
    with patch.object(guidance, "_ransac_candidate", side_effect=_force_epnp_failure):
        result = solve_guidance({"final_reliable_keypoints": points}, landmarks, width, height)
    assert result["success"] is True
    assert result["solver_used"] == "AP3P"
    assert result["inlier_count"] >= 5
    assert result["guidance_status"] == "FULL"


def test_epnp_failure_valid_minimal_ap3p_is_degraded() -> None:
    landmarks, points, width, height = _synthetic_correspondences(4)
    with patch.object(guidance, "_ransac_candidate", side_effect=_force_epnp_failure):
        result = solve_guidance({"final_reliable_keypoints": points}, landmarks, width, height)
    assert result["success"] is True
    assert result["solver_used"] == "AP3P"
    assert result["inlier_count"] == 4
    assert result["guidance_status"] == "DEGRADED"
    assert len(result["covered_sectors"]) == 1
    assert result["degradation_reason"] == "AP3P_MINIMAL_FOUR_POINT_SUPPORT"


def test_invalid_ap3p_is_unavailable() -> None:
    landmarks, points, width, height = _synthetic_correspondences(6)
    inside = np.mean(np.stack(list(landmarks.values())), axis=0)
    invalid_rvec = np.zeros((3, 1), dtype=np.float64)
    invalid_tvec = -inside.reshape(3, 1)
    with patch.object(guidance, "_ransac_candidate", return_value=None), patch.object(
        guidance, "_ap3p_candidates", return_value=[(invalid_rvec, invalid_tvec)]
    ):
        result = solve_guidance({"final_reliable_keypoints": points}, landmarks, width, height)
    assert result["success"] is False
    assert result["guidance_status"] == "UNAVAILABLE"
    assert result["solver_used"] == "NONE"


def test_structural_validation_rejects_camera_inside_vehicle() -> None:
    landmarks, points, width, height = _synthetic_correspondences(6)
    obj = np.stack(list(landmarks.values()))
    img = np.asarray([point["final_xy"] for point in points], dtype=np.float64)
    matrix, distortion, _ = build_approximate_intrinsics(width, height)
    center = np.mean(obj, axis=0)
    validation = guidance._evaluate_pose(
        np.zeros((3, 1)), -center.reshape(3, 1), obj, img, list(landmarks),
        matrix, distortion, landmarks, 12.0,
    )
    assert validation["valid"] is False
    assert "CAMERA_INSIDE_OR_TOO_CLOSE" in validation["reasons"]
