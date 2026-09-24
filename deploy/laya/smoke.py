"""Run real local inference and save synthetic-only evidence; no secrets required."""
import json
import time
from pathlib import Path
from handler import EndpointHandler

handler = EndpointHandler()
requests = [
    {"inputs": {"state": "I explicitly prefer a quick, inexpensive, mild lunch.", "candidates": [
        {"id": "quick", "description": "Quick service, inexpensive, mild food."},
        {"id": "formal", "description": "Slow formal dinner, expensive, spicy food."}]}},
    {"inputs": {"state": "我想食平價、清淡、快啲食完嘅午餐。", "candidates": [
        {"id": "quick", "description": "平價，清淡，快速上菜。"},
        {"id": "formal", "description": "昂貴正式晚餐，辣味，需要長時間用餐。"}]}},
]
requests.extend([
    {"inputs": {"state": "A quick lunch.", "candidates": [
        {"id": "only", "description": "A quick lunch."}]}},
    {"inputs": {"state": "Prefer mild food.", "candidates": [
        {"id": "candidate_" + str(i), "description": "Mild noodles." if i == 0 else "Spicy noodles."}
        for i in range(10)]}},
])
evidence = []
for request in requests:
    started = time.monotonic()
    response = handler(request)
    assert {entry["id"] for entry in response["entries"]} == {
        item["id"] for item in request["inputs"]["candidates"]}
    assert abs(sum(entry["weight"] for entry in response["entries"]) - 1) < 1e-6
    evidence.append({"request": request, "response": response, "seconds": time.monotonic() - started})
Path("local-smoke.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(evidence, ensure_ascii=False, indent=2))
