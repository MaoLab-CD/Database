from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.sample_codes import DerivedSampleRule, parse_sample_code_parts
from app.services.specimen_types import get_confirmed_specimen_code_rules


def sync_sample_relations(
    db: Session,
    *,
    sample_pk: int,
    sample_code: str,
    operator_id: int | None,
    code_rules: tuple[DerivedSampleRule, ...] | None = None,
) -> None:
    """Create confirmed same-origin relations regardless of import order."""
    if code_rules is None:
        code_rules = get_confirmed_specimen_code_rules(db, active_only=False)
    parts = parse_sample_code_parts(sample_code, code_rules)
    if parts is None:
        return

    candidates: list[tuple[str, str]]
    if parts.suffix is None:
        candidates = [
            (f"{parts.base_sample_code}{rule.suffix}", rule.relation_type)
            for rule in code_rules
            if rule.suffix and rule.relation_type
        ]
        child_rows = db.execute(
            text(
                """
                SELECT id, sample_code
                FROM samples
                WHERE is_deleted = false
                  AND sample_code = ANY(:sample_codes)
                """
            ),
            {"sample_codes": [code for code, _ in candidates]},
        ).mappings()
        relation_by_code = dict(candidates)
        relations = [
            (sample_pk, int(row["id"]), relation_by_code[str(row["sample_code"])])
            for row in child_rows
        ]
    else:
        parent_pk = db.execute(
            text(
                """
                SELECT id
                FROM samples
                WHERE is_deleted = false
                  AND sample_code = :sample_code
                """
            ),
            {"sample_code": parts.base_sample_code},
        ).scalar_one_or_none()
        relations = (
            [(int(parent_pk), sample_pk, parts.relation_type)]
            if parent_pk is not None and parts.relation_type is not None
            else []
        )

    for parent_pk, child_pk, relation_type in relations:
        db.execute(
            text(
                """
                INSERT INTO sample_relations (
                    parent_sample_pk, child_sample_pk, relation_type, created_by
                )
                VALUES (
                    :parent_sample_pk, :child_sample_pk, :relation_type, :created_by
                )
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "parent_sample_pk": parent_pk,
                "child_sample_pk": child_pk,
                "relation_type": relation_type,
                "created_by": operator_id,
            },
        )
