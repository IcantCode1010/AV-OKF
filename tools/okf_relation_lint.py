#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import yaml


FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)


def load_yaml(path):
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def read_frontmatter(path):
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER.match(text)
    if not match:
        return {}
    return yaml.safe_load(match.group(1)) or {}


def as_repo_path(path, root):
    return path.relative_to(root).as_posix()


def violation(file_path, relation_index, rule, message, **extra):
    item = {
        "file": file_path,
        "relation_index": relation_index,
        "rule": rule,
        "message": message,
    }
    item.update(extra)
    return item


def is_url_or_scheme(target):
    parsed = urlsplit(target)
    return bool(parsed.scheme)


def resolve_relation_target(source_file, target, knowledge_root):
    if not isinstance(target, str) or not target.strip():
        return None, "missing_target"
    if "\\" in target:
        return None, "backslash_target"
    if is_url_or_scheme(target):
        return None, "url_target"
    if target.startswith("/"):
        return None, "absolute_target"

    parsed = urlsplit(target)
    if parsed.query:
        return None, "query_string_target"
    if parsed.netloc:
        return None, "url_target"

    path_part = unquote(parsed.path)
    if not path_part.endswith(".md"):
        return None, "non_markdown_target"

    pure = PurePosixPath(path_part)
    if pure.is_absolute():
        return None, "absolute_target"

    resolved = (source_file.parent / Path(*pure.parts)).resolve()
    try:
        resolved.relative_to(knowledge_root)
    except ValueError:
        return None, "target_escapes_root"

    if not resolved.exists():
        return resolved, "missing_target_file"
    if not resolved.is_file():
        return resolved, "target_not_file"

    return resolved, None


def iter_markdown_files(knowledge_roots):
    for root in knowledge_roots:
        if not root.exists():
            continue
        yield from sorted(root.rglob("*.md"))


def lint(manifest_path):
    repo_root = manifest_path.parent.resolve()
    manifest = load_yaml(manifest_path)
    allowed_relations = manifest.get("relations", {}).get("allowed", [])
    base_roots = manifest.get("base", {}).get("roots", [])

    violations = []

    if not isinstance(allowed_relations, list) or not allowed_relations:
        violations.append(
            violation(
                str(manifest_path),
                None,
                "missing_allowed_relations",
                "Manifest must define relations.allowed as a non-empty list.",
            )
        )
        allowed_relations = []

    allowed = set(allowed_relations)
    knowledge_roots = []
    for root_entry in base_roots:
        if isinstance(root_entry, dict) and root_entry.get("path"):
            knowledge_roots.append((repo_root / root_entry["path"]).resolve())

    if not knowledge_roots:
        violations.append(
            violation(
                str(manifest_path),
                None,
                "missing_knowledge_roots",
                "Manifest must define at least one base.roots path.",
            )
        )

    for source_file in iter_markdown_files(knowledge_roots):
        source_rel = as_repo_path(source_file, repo_root)
        frontmatter = read_frontmatter(source_file)
        relations = frontmatter.get("relations")
        if relations is None:
            continue
        if not isinstance(relations, list):
            violations.append(
                violation(
                    source_rel,
                    None,
                    "relations_not_list",
                    "relations must be a list.",
                )
            )
            continue

        containing_root = next(root for root in knowledge_roots if source_file.is_relative_to(root))

        for index, relation in enumerate(relations):
            if not isinstance(relation, dict):
                violations.append(
                    violation(
                        source_rel,
                        index,
                        "relation_not_object",
                        "Each relation must be a mapping/object.",
                    )
                )
                continue

            relation_name = relation.get("relation")
            target = relation.get("target")
            target_type = relation.get("target_type")

            if relation_name not in allowed:
                violations.append(
                    violation(
                        source_rel,
                        index,
                        "invalid_relation",
                        "Relation name is not present in relations.allowed.",
                        value=relation_name,
                        allowed=allowed_relations,
                    )
                )

            if not isinstance(target_type, str) or not target_type.strip():
                violations.append(
                    violation(
                        source_rel,
                        index,
                        "missing_target_type",
                        "Relation must declare target_type.",
                    )
                )

            resolved, error = resolve_relation_target(source_file, target, containing_root)
            if error:
                violations.append(
                    violation(
                        source_rel,
                        index,
                        error,
                        "Relation target does not satisfy AV-OKF link-resolution rules.",
                        target=target,
                    )
                )
                continue

            target_frontmatter = read_frontmatter(resolved)
            actual_type = target_frontmatter.get("type")
            if target_type and actual_type != target_type:
                violations.append(
                    violation(
                        source_rel,
                        index,
                        "target_type_mismatch",
                        "Declared target_type does not match resolved target frontmatter type.",
                        target=as_repo_path(resolved, repo_root),
                        declared_target_type=target_type,
                        actual_target_type=actual_type,
                    )
                )

    return violations


def main(argv=None):
    parser = argparse.ArgumentParser(description="Lint AV-OKF typed relations.")
    parser.add_argument("--manifest", default="okf-base.yaml")
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest).resolve()
    violations = lint(manifest_path)
    payload = {
        "status": "fail" if violations else "pass",
        "violation_count": len(violations),
        "violations": violations,
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
