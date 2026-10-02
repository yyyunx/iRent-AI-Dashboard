# Altis 30-point landmark provenance

`altis_30_landmarks.json` is an exact copy of the user-provided `30kpt.json` supplied for phase-two guidance integration (copied 2026-10-01). It was exported from `30kpt.blend` and declares Blender world coordinates, a right-handed Z-up frame, metric units, and `scale_length=1`.

The AI service validates this file against KptNetV1 `metadata/keypoints.json` at startup. Both sources must contain exactly 30 unique names with no missing or extra names. PnP correspondence is performed by exact name and never by array index. A mismatch prevents service startup rather than guessing a mapping.
