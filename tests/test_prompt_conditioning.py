"""CPU regression tests of production functions, with recording CLIP/mask doubles.

AST loading avoids importing ComfyUI/PyTorch; this does not test tensor execution.
Run: python -m unittest discover -s tests -p "test_*.py" -v
"""
import ast
import itertools
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


ROOT = Path(os.environ.get("ARC_SOURCE_ROOT", Path(__file__).resolve().parents[1]))
source = ast.parse((ROOT / "nodes.py").read_text(encoding="utf-8-sig"))
names = {
    "_prompt_value", "_prompts", "_positive_prompt_text", "_global_prompt_text",
    "_region_prompt_text", "_conditioning", "_conditioning_set_values",
    "_set_default", "_set_mask", "_encode_text", "_metadata",
}
selected = [node for node in source.body if (
    isinstance(node, ast.FunctionDef) and node.name in names
) or (
    isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "REGIONS" for target in node.targets
    )
)]
scope = {"torch": SimpleNamespace(max=lambda mask: SimpleNamespace(item=lambda: mask.value)), "json": json}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(ROOT / "nodes.py"), "exec"), scope)


class Mask:
    shape = (1, 1)

    def __init__(self, value):
        self.value = value

    def unsqueeze(self, _):
        return SimpleNamespace(shape=(1, 1, 1), value=self.value)


class RecordingClip:
    def __init__(self):
        self.calls = []
        self.outputs = []

    def tokenize(self, text):
        self.calls.append(text)
        return text

    def encode_from_tokens_scheduled(self, tokens):
        output = [[tokens, {"pooled_output": "pooled"}]]
        self.outputs.append(output)
        return output


class PromptTests(unittest.TestCase):
    def test_external_precedence_for_all_eight_fields(self):
        missing = object()
        for key, external, local in itertools.product(
            ["quality", "scene", "negative", "red", "blue", "yellow", "green", "magenta"],
            [missing, None, "", "   ", "EXTERNAL"],
            ["LOCAL", ""],
        ):
            with self.subTest(key=key, external=external, local=local):
                kwargs = {f"{key}_prompt": local, "base_prompt": "LEGACY"}
                if external is not missing:
                    kwargs[f"{key}_prompt_in"] = external
                expected = local if external is missing or external is None else external
                prompts = scope["_prompts"](kwargs)
                self.assertEqual(prompts[key], expected)
                metadata = json.loads(scope["_metadata"](prompts, 64, 64, "standard", True, 1))
                self.assertEqual(metadata[key] if key in ("quality", "scene", "negative")
                                 else metadata["regions"][key.upper()], expected)

    def test_legacy_base_only_when_modern_quality_is_absent_or_none(self):
        for kwargs, expected in [
            ({}, ""),
            ({"base_prompt": "OLD"}, "OLD"),
            ({"base_prompt": "OLD", "base_prompt_in": ""}, ""),
            ({"base_prompt": "OLD", "base_prompt_in": None}, "OLD"),
            ({"base_prompt": "OLD", "quality_prompt": ""}, ""),
            ({"base_prompt": "OLD", "quality_prompt": None}, "OLD"),
            ({"base_prompt": "OLD", "quality_prompt_in": ""}, ""),
            ({"base_prompt": "OLD", "quality_prompt": "NEW"}, "NEW"),
        ]:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(scope["_prompts"](kwargs)["quality"], expected)

    def test_disconnect_returns_to_local(self):
        kwargs = {"red_prompt": "LOCAL", "red_prompt_in": ""}
        self.assertEqual(scope["_prompts"](kwargs)["red"], "")
        del kwargs["red_prompt_in"]
        self.assertEqual(scope["_prompts"](kwargs)["red"], "LOCAL")


class ConditioningTests(unittest.TestCase):
    def test_global_region_and_encode_count_matrix(self):
        for global_text, painted, unused, enabled in itertools.product(
            ["", "QUALITY\n\nSCENE"], [(), ("red",), ("red", "green")], [False, True], [False, True]
        ):
            with self.subTest(global_text=global_text, painted=painted, unused=unused, enabled=enabled):
                prompts = scope["_prompts"]({
                    "quality_prompt": "QUALITY" if global_text else "",
                    "scene_prompt": "SCENE" if global_text else "",
                    "red_prompt": "RED_ONLY", "green_prompt": "GREEN_ONLY",
                    "blue_prompt": "UNPAINTED_BLUE" if unused else "",
                    "negative_prompt": "NEGATIVE",
                })
                masks = {key: Mask(int(key in painted)) for key, _, _ in scope["REGIONS"]}
                clip = RecordingClip()
                positive, negative = scope["_conditioning"](clip, prompts, masks, .95, enabled)
                self.assertEqual(negative[0][0], "NEGATIVE")
                self.assertTrue(all("default" not in item[1] for output in clip.outputs for item in output))
                self.assertEqual(positive[0][1]["pooled_output"], "pooled")
                if enabled:
                    expected = [global_text] + ["\n\n".join(filter(None, [global_text, prompts[key]])) for key in painted]
                    self.assertEqual(clip.calls, expected + ["NEGATIVE"])
                    self.assertEqual(len(positive), 1 + len(painted))
                    self.assertEqual(positive[0][1].get("default", False), bool(painted))
                    self.assertTrue(all("UNPAINTED_BLUE" not in entry[0] for entry in positive))
                    for entry in positive[1:]:
                        self.assertEqual(entry[1]["mask_strength"], .95)
                else:
                    self.assertEqual(clip.calls, [scope["_positive_prompt_text"](prompts), "NEGATIVE"])
                    self.assertEqual(len(positive), 1)

    def test_missing_masks_and_empty_painted_prompts_encode_global_once(self):
        for masks in [{}, {"red": Mask(1)}]:
            clip = RecordingClip()
            positive, _ = scope["_conditioning"](clip, scope["_prompts"]({}), masks, 1)
            self.assertEqual(clip.calls, ["", ""])
            self.assertNotIn("default", positive[0][1])

    def test_legacy_clip_encoding_still_works(self):
        class LegacyClip:
            def tokenize(self, text):
                return text

            def encode_from_tokens(self, text, return_pooled=True):
                return text, "pooled"

        positive, _ = scope["_conditioning"](LegacyClip(), scope["_prompts"]({}), {}, 1)
        self.assertEqual(positive, [["", {"pooled_output": "pooled"}]])


if __name__ == "__main__":
    unittest.main()
