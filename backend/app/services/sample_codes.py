from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


BASE_SPECIMEN_TYPE = "全血"


@dataclass(frozen=True)
class DerivedSampleRule:
    suffix: str
    specimen_type: str
    relation_type: str


# These defaults keep pure helpers and maintenance scripts usable. Production
# paths pass the confirmed rules loaded from specimen_types.
DERIVED_SAMPLE_RULES = (
    DerivedSampleRule("d", "DNA", "dna_extraction"),
    DerivedSampleRule("L", "类器官", "organoid_derivation"),
    DerivedSampleRule("S", "血清", "serum_derivation"),
)
BASE_SAMPLE_RULE = DerivedSampleRule("", BASE_SPECIMEN_TYPE, "")
DEFAULT_SAMPLE_CODE_RULES = (BASE_SAMPLE_RULE, *DERIVED_SAMPLE_RULES)

SAMPLE_CODE_PATTERN = re.compile(
    r"^(?P<center_code>[0-9]{6}-[0-9]{3})-"
    r"(?P<base_seq>[0-9]{10})(?P<suffix>[A-Za-z]?)$"
)


@dataclass(frozen=True)
class SampleCodeParts:
    sample_code: str
    center_code: str
    base_seq: str
    suffix: str | None
    resolved_specimen_type: str
    resolved_relation_type: str | None

    @property
    def sample_seq(self) -> str:
        return f"{self.base_seq}{self.suffix or ''}"

    @property
    def base_sample_code(self) -> str:
        return f"{self.center_code}-{self.base_seq}"

    @property
    def specimen_type(self) -> str:
        return self.resolved_specimen_type

    @property
    def relation_type(self) -> str | None:
        return self.resolved_relation_type


def relation_type_for_rule(specimen_type: str, suffix: str) -> str | None:
    if not suffix:
        return None
    known = {
        "DNA": "dna_extraction",
        "类器官": "organoid_derivation",
        "血清": "serum_derivation",
    }
    return known.get(specimen_type, f"derived_{suffix}")


def parse_sample_code_parts(
    sample_code: str,
    code_rules: Iterable[DerivedSampleRule] | None = None,
) -> SampleCodeParts | None:
    match = SAMPLE_CODE_PATTERN.fullmatch(sample_code)
    if match is None:
        return None
    suffix_value = match.group("suffix")
    rules = code_rules if code_rules is not None else DEFAULT_SAMPLE_CODE_RULES
    rule_by_suffix = {rule.suffix: rule for rule in rules}
    rule = rule_by_suffix.get(suffix_value)
    if rule is None:
        return None
    return SampleCodeParts(
        sample_code=sample_code,
        center_code=match.group("center_code"),
        base_seq=match.group("base_seq"),
        suffix=suffix_value or None,
        resolved_specimen_type=rule.specimen_type,
        resolved_relation_type=rule.relation_type or None,
    )


def specimen_type_from_sample_code(
    sample_code: str,
    code_rules: Iterable[DerivedSampleRule] | None = None,
) -> str | None:
    parts = parse_sample_code_parts(sample_code, code_rules)
    return parts.specimen_type if parts is not None else None
