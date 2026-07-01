import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LINTER = REPO_ROOT / "tools" / "okf_relation_lint.py"


class RelationLintTests(unittest.TestCase):
    def run_lint(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for relative_path, content in files.items():
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(LINTER), "--manifest", "okf-base.yaml"],
                cwd=root,
                text=True,
                capture_output=True,
            )
            return result.returncode, json.loads(result.stdout)

    def test_valid_relation_uses_manifest_enum_and_target_frontmatter_type(self):
        code, payload = self.run_lint(
            {
                "okf-base.yaml": """
                    okf_version: '0.1'
                    base:
                      roots:
                        - path: knowledge
                    relations:
                      allowed:
                        - routes_to
                """,
                "knowledge/faults/elt.md": """
                    ---
                    type: fault_route
                    relations:
                      - relation: routes_to
                        target: ../manuals/mel/elt.md
                        target_type: dispatch_reference
                    ---
                    # ELT
                """,
                "knowledge/manuals/mel/elt.md": """
                    ---
                    type: dispatch_reference
                    ---
                    # ELT MEL
                """,
            }
        )

        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "pass")
        self.assertEqual(payload["violations"], [])

    def test_invalid_relation_name_reports_structured_violation(self):
        code, payload = self.run_lint(
            {
                "okf-base.yaml": """
                    okf_version: '0.1'
                    base:
                      roots:
                        - path: knowledge
                    relations:
                      allowed:
                        - routes_to
                """,
                "knowledge/faults/elt.md": """
                    ---
                    type: fault_route
                    relations:
                      - relation: maybe_routes_to
                        target: ../manuals/mel/elt.md
                        target_type: dispatch_reference
                    ---
                    # ELT
                """,
                "knowledge/manuals/mel/elt.md": """
                    ---
                    type: dispatch_reference
                    ---
                    # ELT MEL
                """,
            }
        )

        self.assertEqual(code, 1)
        self.assertEqual(payload["status"], "fail")
        self.assertEqual(payload["violations"][0]["file"], "knowledge/faults/elt.md")
        self.assertEqual(payload["violations"][0]["relation_index"], 0)
        self.assertEqual(payload["violations"][0]["rule"], "invalid_relation")

    def test_target_type_must_match_resolved_target_frontmatter_type(self):
        code, payload = self.run_lint(
            {
                "okf-base.yaml": """
                    okf_version: '0.1'
                    base:
                      roots:
                        - path: knowledge
                    relations:
                      allowed:
                        - routes_to
                """,
                "knowledge/faults/elt.md": """
                    ---
                    type: fault_route
                    relations:
                      - relation: routes_to
                        target: ../manuals/mel/elt.md
                        target_type: dispatch_reference
                    ---
                    # ELT
                """,
                "knowledge/manuals/mel/elt.md": """
                    ---
                    type: training_reference
                    ---
                    # ELT Training
                """,
            }
        )

        self.assertEqual(code, 1)
        violation = payload["violations"][0]
        self.assertEqual(violation["file"], "knowledge/faults/elt.md")
        self.assertEqual(violation["relation_index"], 0)
        self.assertEqual(violation["rule"], "target_type_mismatch")


if __name__ == "__main__":
    unittest.main()
