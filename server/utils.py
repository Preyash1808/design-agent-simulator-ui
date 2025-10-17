"""
Utility functions shared across the application.
"""
import json
import pathlib
import re
from typing import Dict, Any, List


def write_json(path: pathlib.Path, data: Dict[str, Any]) -> None:
    """Write JSON data to file with pretty formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def slugify(value: str) -> str:
    """Convert string to URL-friendly slug."""
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", value or '').strip('-').lower()
    return s or 'project'


def _severity_for_category(cat: str) -> int:
    """Map friction category to severity level (1-5)."""
    c = (cat or '').lower()
    if c in {'loop_detected'}:
        return 4
    if c in {'auto_wait', 'unclear_primary_cta_persona'}:
        return 3
    if c in {'back_or_close', 'choice_overload_persona', 'resistance_to_prompts_persona', 'anxiety_wait_persona'}:
        return 2
    return 1

