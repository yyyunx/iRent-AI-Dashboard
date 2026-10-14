from __future__ import annotations

import json
from typing import Any

LEGACY_QWEN_PROMPT = """You are the semantic verification layer after a high-recall DamageNet detector, not the primary detector.
For every candidate there are two images: (1) the full vehicle photo with only that
candidate highlighted in red and (2) a padded crop of that candidate. Review only the
highlighted candidate. Normal vehicle structures, reflections, shadows, dirt, panel
gaps/seams, lights, mirrors, and image/compression artifacts are NOT damage. If the
visual evidence is insufficient, set is_damage to false and explain the uncertainty.
Return JSON only, with exactly this shape:
{"candidates":[{"candidate_id":1,"is_damage":true,"damage_type":"scratch|dent|crack|broken|other|none","confidence":0.0,"reason":"brief factual explanation"}]}
confidence must be a JSON number from 0.0 to 1.0. Set damage_type to "none" whenever
is_damage is false, and never use "none" when is_damage is true.
Candidate metadata:
"""

RECALL_V3_QWEN_PROMPT = """You are a high-recall semantic verification layer after a vehicle damage detector, not the primary detector.

For each candidate, you are given two images:
1. The full vehicle photo with only the candidate highlighted in red.
2. A 20% padded crop of the same candidate.

Review only the highlighted candidate. Use the full image to understand vehicle geometry and the crop to inspect local details.

The detector has already identified this region as potentially damaged. Your task is to reject clearly false-positive candidates while preserving potentially genuine physical damage.

Prioritize avoiding false negatives.

Recognize the following damage types:

- scratch: visible scraping, scuffing, paint abrasion, or surface scratches.
- dent: dents, bent panels, folded metal, creases, buckling, or collision-induced body panel deformation.
- crack: visible fractures or cracks in vehicle components.
- broken: visibly broken, fractured, detached, or missing exterior components.
- other: other plausible physical damage, including displaced or misaligned body panels or components caused by impact.
- none: a candidate that can be confidently identified as normal vehicle structure or a non-damage visual artifact.

Normal panel seams, manufacturing gaps, original body contours, reflections, shadows, dirt, lights, mirrors, and image/compression artifacts are not damage by themselves.

However, do not dismiss a candidate merely because its damage is subtle, partially visible, or difficult to classify into a specific category.

A candidate should be classified as "none" only when the visible region is sufficiently explained by normal vehicle structure or a non-damage artifact.

If the candidate could plausibly represent physical damage and cannot be confidently dismissed as normal, prefer a damage category over "none".

One plausible physical defect is sufficient. Multiple independent damage indicators are not required.

Do not automatically trust the detector's damage label or confidence. Use the images as the primary evidence.

Return JSON only, with exactly this shape:

{"candidate_id":1,"damage_type":"dent"}

Allowed damage_type values:

"scratch", "dent", "crack", "broken", "other", "none"

Do not include explanations, confidence scores, Markdown, or additional fields.

Candidate metadata:
"""

# Kept as an import-compatible alias for the pre-V3 benchmark scripts.
QWEN_PROMPT = LEGACY_QWEN_PROMPT
ALLOWED_DAMAGE_TYPES = {"scratch", "dent", "crack", "broken", "other", "none"}


def _extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError("Qwen response did not contain a valid JSON object")


def parse_qwen_response(text: str, candidate_ids: list[int]) -> list[dict[str, Any]]:
    payload = _extract_json_object(text)
    items = payload.get("candidates")
    if not isinstance(items, list):
        raise ValueError("Qwen response candidates must be an array")
    expected_ids = set(candidate_ids)
    normalized: dict[int, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("candidate_id"), int):
            continue
        candidate_id = item["candidate_id"]
        if candidate_id not in expected_ids or candidate_id in normalized:
            continue
        is_damage = item.get("is_damage")
        damage_type = item.get("damage_type")
        confidence = item.get("confidence")
        if type(is_damage) is not bool or damage_type not in ALLOWED_DAMAGE_TYPES:
            continue
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
            continue
        if (not is_damage and damage_type != "none") or (is_damage and damage_type == "none"):
            continue
        normalized[candidate_id] = {
            "candidate_id": candidate_id, "is_damage": is_damage,
            "damage_type": damage_type, "confidence": float(confidence),
            "reason": str(item.get("reason") or "").strip()[:240],
        }
    if set(normalized) != expected_ids:
        raise ValueError("Qwen response did not contain one valid result per candidate")
    return [normalized[index] for index in candidate_ids]


def parse_recall_v3_response(text: str, candidate_id: int) -> dict[str, Any]:
    payload = _extract_json_object(text)
    if set(payload) != {"candidate_id", "damage_type"}:
        raise ValueError("Qwen V3 response contained unexpected or missing fields")
    if type(payload["candidate_id"]) is not int or payload["candidate_id"] != candidate_id:
        raise ValueError("Qwen V3 response candidate_id did not match the request")
    damage_type = payload["damage_type"]
    if damage_type not in ALLOWED_DAMAGE_TYPES:
        raise ValueError("Qwen V3 response contained an invalid damage_type")
    return {
        "candidate_id": candidate_id,
        "is_damage": damage_type != "none",
        "damage_type": damage_type,
        # V3 intentionally does not ask Qwen for uncalibrated confidence or prose.
        # These compatibility values preserve the established API/DB/LINE shape.
        "confidence": 0.0,
        "reason": f"Recall-oriented V3 classified this candidate as {damage_type}.",
    }
