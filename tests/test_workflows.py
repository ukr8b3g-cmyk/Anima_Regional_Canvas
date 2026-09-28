import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = [
    ROOT / "workflows" / "Anima_Regional_Canvas_Test.json",
    ROOT / "workflows" / "Anima_Regional_Inpaint_Canvas_Test.json",
]


class WorkflowIntegrityTests(unittest.TestCase):
    def test_workflows_parse_and_do_not_duplicate_canvas_payload(self):
        for path in WORKFLOWS:
            with self.subTest(path=path.name):
                data = json.loads(path.read_text(encoding="utf-8"))
                nodes = [
                    node
                    for node in data.get("nodes", [])
                    if node.get("type") in {"AnimaRegionalCanvas", "AnimaRegionalInpaintCanvas"}
                ]
                self.assertEqual(len(nodes), 1)
                node = nodes[0]
                self.assertNotIn("arcCanvasData", node.get("properties", {}))
                canvas_payloads = [
                    value
                    for value in node.get("widgets_values", [])
                    if isinstance(value, str) and '"version":2' in value and '"width":' in value
                ]
                self.assertEqual(len(canvas_payloads), 1)


if __name__ == "__main__":
    unittest.main()
