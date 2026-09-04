from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.sample_codes import DerivedSampleRule, relation_type_for_rule


def get_active_specimen_type_names(
    db: Session,
    *,
    batch_code_only: bool = False,
) -> set[str]:
    rows = db.execute(
        text(
            """
            SELECT name
            FROM specimen_types
            WHERE is_active = true
              AND (
                  :batch_code_only = false
                  OR (allow_batch_code = true AND code_rule_confirmed = true)
              )
            ORDER BY sort_order, id
            """
        ),
        {"batch_code_only": batch_code_only},
    ).scalars()
    return {str(name) for name in rows}


def get_confirmed_specimen_code_rules(
    db: Session,
    *,
    active_only: bool = True,
    batch_code_only: bool = False,
) -> tuple[DerivedSampleRule, ...]:
    rows = (
        db.execute(
            text(
                """
                SELECT name, code_suffix
                FROM specimen_types
                WHERE code_rule_confirmed = true
                  AND code_suffix IS NOT NULL
                  AND (:active_only = false OR is_active = true)
                  AND (:batch_code_only = false OR allow_batch_code = true)
                ORDER BY sort_order, id
                """
            ),
            {
                "active_only": active_only,
                "batch_code_only": batch_code_only,
            },
        )
        .mappings()
        .all()
    )
    return tuple(
        DerivedSampleRule(
            suffix=str(row["code_suffix"]),
            specimen_type=str(row["name"]),
            relation_type=relation_type_for_rule(
                str(row["name"]),
                str(row["code_suffix"]),
            )
            or "",
        )
        for row in rows
    )
