from pathlib import Path

from app.services.sequencing_scanner import (
    find_sample_data_dir,
    identifier_candidates,
    is_sample_dir_name,
)


def test_existing_raw_data_layout_is_preserved(tmp_path: Path) -> None:
    project = tmp_path / "X101SC26015140-Z01-J014"
    raw_data = project / "01.RawData"
    raw_data.mkdir(parents=True)

    assert find_sample_data_dir(project) == raw_data


def test_nas_direct_layout_accepts_historical_numeric_samples(tmp_path: Path) -> None:
    project = tmp_path / "X101SC25097427-Z01-J001"
    three_digit = project / "920"
    four_digit = project / "5010"
    six_digit = project / "010702"
    three_digit.mkdir(parents=True)
    four_digit.mkdir(parents=True)
    six_digit.mkdir()

    assert find_sample_data_dir(project) == project
    assert is_sample_dir_name(project.name, three_digit.name)
    assert is_sample_dir_name(project.name, four_digit.name)
    assert is_sample_dir_name(project.name, six_digit.name)


def test_historical_numeric_identifiers_are_not_project_specific() -> None:
    assert is_sample_dir_name("X101SC25097427-Z01-J001", "5010")
    assert is_sample_dir_name("X101SC26015140-Z01-J002", "5010")


def test_nas_date_prefixed_identifiers_are_accepted_without_rewriting() -> None:
    assert is_sample_dir_name("X101SC25097427-Z01-J003", "25120101")
    assert is_sample_dir_name("X101SC25097427-Z01-J004", "2025120905")
    assert identifier_candidates("25120101") == ["25120101"]
    assert identifier_candidates("2025120905") == ["2025120905"]


def test_three_digit_identifier_is_accepted_without_rewriting() -> None:
    assert is_sample_dir_name("X101SC25097427-Z01-J006", "920")


def test_short_numeric_identifier_can_match_zero_padded_sample_id() -> None:
    assert set(identifier_candidates("50101")) == {"50101", "050101"}


def test_four_digit_identifier_is_exact_and_not_zero_padded() -> None:
    assert identifier_candidates("5035") == ["5035"]


def test_project_year_allows_date_prefix_to_match_six_digit_sample_id() -> None:
    project_code = "X101SC26043728-Z01-J009"

    assert identifier_candidates("26060101", project_code) == ["26060101", "060101"]


def test_four_digit_year_date_prefix_is_supported_with_matching_project_year() -> None:
    project_code = "X101SC25097427-Z01-J004"

    assert identifier_candidates("2025120905", project_code) == ["2025120905", "120905"]


def test_date_prefix_is_not_rewritten_for_another_project_year() -> None:
    project_code = "X101SC25097427-Z01-J009"

    assert identifier_candidates("26060101", project_code) == ["26060101"]


def test_invalid_date_prefix_is_not_rewritten() -> None:
    project_code = "X101SC26043728-Z01-J009"

    assert identifier_candidates("26133201", project_code) == ["26133201"]


def test_formal_sample_codes_are_accepted() -> None:
    assert is_sample_dir_name("X101SC26015140-Z01-J014", "510115-001-2601070001")
    assert not is_sample_dir_name("X101SC26015140-Z01-J014", "510115-001-2601070001d")
    assert identifier_candidates("510105-002-2606260015") == [
        "510105-002-2606260015"
    ]


def test_direct_numeric_children_require_project_naming(tmp_path: Path) -> None:
    unrelated = tmp_path / "ordinary-folder"
    (unrelated / "5010").mkdir(parents=True)

    assert find_sample_data_dir(unrelated) is None


def test_historical_identifier_candidates_do_not_rewrite_long_ids() -> None:
    assert identifier_candidates("25120101") == ["25120101"]
    assert identifier_candidates("2025120905") == ["2025120905"]
