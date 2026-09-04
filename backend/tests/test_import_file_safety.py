from pathlib import Path

from app.api.routes.imports import temporary_import_file


def test_temporary_import_file_is_removed_after_processing() -> None:
    temporary_path: Path | None = None

    with temporary_import_file(b"sample_code\n510115-001-2601010001\n", ".csv") as path:
        temporary_path = path
        assert path.exists()
        assert path.read_bytes().startswith(b"sample_code")

    assert temporary_path is not None
    assert not temporary_path.exists()
    assert not temporary_path.parent.exists()
