from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vehicle_gate import VEHICLE_GATE_CONF_THRESHOLD, vehicle_gate_passes


class VehicleGateTest(unittest.TestCase):
    def test_sanity_check_false_positive_is_rejected(self):
        self.assertFalse(vehicle_gate_passes([10.65, 0.0, 1234.44, 744.78], 0.242827))

    def test_threshold_boundary_is_accepted(self):
        self.assertEqual(VEHICLE_GATE_CONF_THRESHOLD, 0.50)
        self.assertFalse(vehicle_gate_passes([1.0, 2.0, 30.0, 40.0], 0.499999))
        self.assertTrue(vehicle_gate_passes([1.0, 2.0, 30.0, 40.0], 0.50))

    def test_normal_vehicle_confidence_is_accepted(self):
        self.assertTrue(vehicle_gate_passes([1.0, 2.0, 30.0, 40.0], 0.88))

    def test_missing_bbox_is_rejected(self):
        self.assertFalse(vehicle_gate_passes(None, None))


if __name__ == "__main__":
    unittest.main()
