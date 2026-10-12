from __future__ import annotations

import math
from collections.abc import Sequence


VEHICLE_GATE_CONF_THRESHOLD = 0.50


def vehicle_gate_passes(bbox_xyxy: Sequence[float] | None, confidence: float | None) -> bool:
    if bbox_xyxy is None or confidence is None or len(bbox_xyxy) != 4:
        return False
    x1, y1, x2, y2 = bbox_xyxy
    return (
        all(math.isfinite(value) for value in bbox_xyxy)
        and math.isfinite(confidence)
        and x2 > x1
        and y2 > y1
        and confidence >= VEHICLE_GATE_CONF_THRESHOLD
    )
