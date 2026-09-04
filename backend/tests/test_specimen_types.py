import pytest
from fastapi import HTTPException

from app.api.routes.specimen_types import normalize_code_rule


def test_unconfirmed_type_cannot_participate_in_batch_code() -> None:
    with pytest.raises(HTTPException, match="编码规则未确认"):
        normalize_code_rule(
            name="血浆",
            code_rule_confirmed=False,
            code_suffix=None,
            allow_batch_code=True,
        )


def test_confirmed_derived_type_requires_one_ascii_letter() -> None:
    assert normalize_code_rule(
        name="血清",
        code_rule_confirmed=True,
        code_suffix="S",
        allow_batch_code=True,
    ) == "S"

    with pytest.raises(HTTPException, match="一个英文字母"):
        normalize_code_rule(
            name="血清",
            code_rule_confirmed=True,
            code_suffix="SS",
            allow_batch_code=False,
        )


def test_full_blood_rule_has_no_suffix() -> None:
    assert normalize_code_rule(
        name="全血",
        code_rule_confirmed=True,
        code_suffix=None,
        allow_batch_code=True,
    ) == ""
