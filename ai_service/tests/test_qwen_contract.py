import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qwen_contract import parse_qwen_response, parse_recall_v3_response


class QwenContractTest(unittest.TestCase):
    def test_valid_structured_response(self):
        payload = {"candidates": [{"candidate_id": 3, "is_damage": True, "damage_type": "scratch", "confidence": 0.91, "reason": "Visible linear scratch."}]}
        result = parse_qwen_response(f"```json\n{json.dumps(payload)}\n```", [3])[0]
        self.assertTrue(result["is_damage"])
        self.assertEqual(result["confidence"], 0.91)

    def test_rejection_requires_none_type(self):
        payload = {"candidates": [{"candidate_id": 1, "is_damage": False, "damage_type": "none", "confidence": 0.84, "reason": "Panel reflection."}]}
        self.assertFalse(parse_qwen_response(json.dumps(payload), [1])[0]["is_damage"])

    def test_malformed_response_fails_closed(self):
        with self.assertRaises(ValueError):
            parse_qwen_response("not json", [1])

    def test_missing_candidate_fails_closed(self):
        with self.assertRaises(ValueError):
            parse_qwen_response('{"candidates":[]}', [1])

    def test_invalid_confidence_fails_closed(self):
        payload = {"candidates": [{"candidate_id": 1, "is_damage": True, "damage_type": "dent", "confidence": 2, "reason": "Dent."}]}
        with self.assertRaises(ValueError):
            parse_qwen_response(json.dumps(payload), [1])


class RecallV3ContractTest(unittest.TestCase):
    def test_damage_type_is_the_only_source_of_is_damage(self):
        damaged = parse_recall_v3_response('{"candidate_id":1,"damage_type":"dent"}', 1)
        rejected = parse_recall_v3_response('{"candidate_id":1,"damage_type":"none"}', 1)
        self.assertTrue(damaged["is_damage"])
        self.assertFalse(rejected["is_damage"])
        self.assertEqual(damaged["confidence"], 0.0)

    def test_code_fence_and_leading_text_are_tolerated(self):
        result = parse_recall_v3_response('result:\n```json\n{"candidate_id":3,"damage_type":"scratch"}\n```', 3)
        self.assertEqual(result["damage_type"], "scratch")

    def test_parse_failure_is_not_coerced_to_none(self):
        with self.assertRaises(ValueError):
            parse_recall_v3_response("!!!!!!!!!!!!!!!!", 1)

    def test_missing_extra_or_wrong_candidate_fields_fail(self):
        invalid = [
            '{"candidate_id":1}',
            '{"candidate_id":1,"damage_type":"dent","is_damage":true}',
            '{"candidate_id":2,"damage_type":"dent"}',
            '{"candidate_id":1,"damage_type":"paint"}',
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse_recall_v3_response(payload, 1)


if __name__ == "__main__":
    unittest.main()
