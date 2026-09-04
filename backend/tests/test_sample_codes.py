from app.services.excel_importer import build_payload, parse_sample_code
from app.services.sample_codes import (
    BASE_SAMPLE_RULE,
    DerivedSampleRule,
    parse_sample_code_parts,
)


def test_parse_confirmed_sample_code_variants() -> None:
    base = parse_sample_code_parts("510115-001-2505010001")
    dna = parse_sample_code_parts("510115-001-2505010001d")
    organoid = parse_sample_code_parts("510115-001-2505010001L")
    serum = parse_sample_code_parts("510115-001-2505010001S")

    assert base is not None
    assert base.specimen_type == "全血"
    assert base.base_sample_code == "510115-001-2505010001"
    assert dna is not None
    assert dna.specimen_type == "DNA"
    assert dna.relation_type == "dna_extraction"
    assert dna.base_sample_code == base.sample_code
    assert organoid is not None
    assert organoid.specimen_type == "类器官"
    assert organoid.relation_type == "organoid_derivation"
    assert organoid.base_sample_code == base.sample_code
    assert serum is not None
    assert serum.specimen_type == "血清"
    assert serum.relation_type == "serum_derivation"
    assert serum.base_sample_code == base.sample_code


def test_sample_code_suffix_is_case_sensitive_and_rejects_unknown_suffix() -> None:
    assert parse_sample_code_parts("510115-001-2505010001D") is None
    assert parse_sample_code_parts("510115-001-2505010001l") is None
    assert parse_sample_code_parts("510115-001-2505010001O") is None


def test_runtime_confirmed_rule_can_add_a_new_suffix() -> None:
    plasma_rule = DerivedSampleRule("P", "血浆", "derived_P")

    assert parse_sample_code_parts("510115-001-2505010001P") is None
    parsed = parse_sample_code_parts(
        "510115-001-2505010001P",
        (BASE_SAMPLE_RULE, plasma_rule),
    )

    assert parsed is not None
    assert parsed.specimen_type == "血浆"


def test_legacy_tuple_parser_keeps_full_sample_seq() -> None:
    assert parse_sample_code("510115-001-2505010001L") == (
        "510115-001",
        "2505010001L",
    )


def test_import_infers_organoid_type_from_confirmed_suffix() -> None:
    payload = build_payload(
        headers=["序", "sample_code", "标本"],
        row_values=("123456", "510115-001-2505010001L", "全血"),
        row_number=2,
        allow_nonstandard=False,
        require_sample_code=True,
    )

    assert payload["core"]["specimen_type"] == "类器官"


def test_base_code_does_not_overwrite_explicit_non_blood_type() -> None:
    payload = build_payload(
        headers=["序", "sample_code", "标本"],
        row_values=("123456", "510115-001-2505010001", "血清"),
        row_number=2,
        allow_nonstandard=False,
        require_sample_code=True,
    )

    assert payload["core"]["specimen_type"] == "血清"


def test_base_code_defaults_blank_specimen_type_to_full_blood() -> None:
    payload = build_payload(
        headers=["序", "sample_code", "标本"],
        row_values=("123456", "510115-001-2505010001", None),
        row_number=2,
        allow_nonstandard=False,
        require_sample_code=True,
    )

    assert payload["core"]["specimen_type"] == "全血"
