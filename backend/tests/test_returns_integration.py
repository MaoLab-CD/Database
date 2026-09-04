from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import engine, get_db
from app.main import app


RUN_DB_INTEGRATION_TESTS = os.getenv("RUN_DB_INTEGRATION_TESTS") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_DB_INTEGRATION_TESTS,
    reason="设置 RUN_DB_INTEGRATION_TESTS=1 后才连接 PostgreSQL 测试库",
)


@dataclass
class IntegrationContext:
    connection: Connection
    outer_transaction: object
    session: Session
    client: TestClient
    admin: CurrentUser


@pytest.fixture
def integration_context() -> IntegrationContext:
    connection = engine.connect()
    outer_transaction = connection.begin()
    session = Session(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    suffix = uuid4().hex[:12]
    admin_id = session.execute(
        text(
            """
            INSERT INTO users (
                username,
                password_hash,
                display_name,
                role,
                is_super_admin,
                permissions,
                status
            )
            VALUES (
                :username,
                :password_hash,
                :display_name,
                'admin',
                false,
                '{}'::jsonb,
                'active'
            )
            RETURNING id
            """
        ),
        {
            "username": f"it-return-{suffix}",
            "password_hash": "integration-test-only",
            "display_name": "归还集成测试管理员",
        },
    ).scalar_one()
    session.commit()

    admin = CurrentUser(
        id=admin_id,
        username=f"it-return-{suffix}",
        display_name="归还集成测试管理员",
        role="admin",
        is_super_admin=False,
        permissions={},
        password_reset_required=False,
    )

    def override_db():
        yield session

    def override_user() -> CurrentUser:
        return admin

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    client = TestClient(app)

    try:
        yield IntegrationContext(
            connection=connection,
            outer_transaction=outer_transaction,
            session=session,
            client=client,
            admin=admin,
        )
    finally:
        client.close()
        app.dependency_overrides.clear()
        session.close()
        if outer_transaction.is_active:
            outer_transaction.rollback()
        connection.close()


def seed_pending_dna_return(
    context: IntegrationContext,
    *,
    sample_status: str = "return_pending",
) -> dict[str, int | str]:
    suffix = uuid4().hex[:12]
    sample_id = f"IT-{suffix}"
    plate_code = f"IT-PLATE-{suffix}"
    sample_pk = context.session.execute(
        text(
            """
            INSERT INTO samples (
                sample_id,
                specimen_type,
                sample_status,
                storage_location,
                current_holder_id,
                created_by,
                updated_by
            )
            VALUES (
                :sample_id,
                'DNA',
                :sample_status,
                :storage_location,
                :current_holder_id,
                :operator_id,
                :operator_id
            )
            RETURNING id
            """
        ),
        {
            "sample_id": sample_id,
            "sample_status": sample_status,
            "storage_location": f"{plate_code} / A01",
            "current_holder_id": context.admin.id,
            "operator_id": context.admin.id,
        },
    ).scalar_one()
    plate_id = context.session.execute(
        text(
            """
            INSERT INTO sample_plates (
                plate_code,
                created_by,
                updated_by
            )
            VALUES (
                :plate_code,
                :operator_id,
                :operator_id
            )
            RETURNING id
            """
        ),
        {"plate_code": plate_code, "operator_id": context.admin.id},
    ).scalar_one()
    well_id = context.session.execute(
        text(
            """
            INSERT INTO sample_plate_wells (
                plate_id,
                well_code,
                sample_pk,
                placed_by
            )
            VALUES (
                :plate_id,
                'A01',
                :sample_pk,
                :operator_id
            )
            RETURNING id
            """
        ),
        {
            "plate_id": plate_id,
            "sample_pk": sample_pk,
            "operator_id": context.admin.id,
        },
    ).scalar_one()
    checkout_id = context.session.execute(
        text(
            """
            INSERT INTO sample_checkout_records (
                sample_pk,
                sample_id,
                checkout_user_id,
                status
            )
            VALUES (
                :sample_pk,
                :sample_id,
                :operator_id,
                'active'
            )
            RETURNING id
            """
        ),
        {
            "sample_pk": sample_pk,
            "sample_id": sample_id,
            "operator_id": context.admin.id,
        },
    ).scalar_one()
    return_id = context.session.execute(
        text(
            """
            INSERT INTO sample_return_records (
                sample_pk,
                sample_id,
                checkout_record_id,
                returned_by,
                return_location,
                status
            )
            VALUES (
                :sample_pk,
                :sample_id,
                :checkout_record_id,
                :operator_id,
                :return_location,
                'pending'
            )
            RETURNING id
            """
        ),
        {
            "sample_pk": sample_pk,
            "sample_id": sample_id,
            "checkout_record_id": checkout_id,
            "operator_id": context.admin.id,
            "return_location": f"{plate_code} / A01",
        },
    ).scalar_one()
    context.session.commit()
    return {
        "sample_pk": sample_pk,
        "plate_id": plate_id,
        "well_id": well_id,
        "checkout_id": checkout_id,
        "return_id": return_id,
        "sample_id": sample_id,
        "plate_code": plate_code,
    }


def test_import_batch_confirm_storage_only_updates_not_stored_samples(
    integration_context: IntegrationContext,
) -> None:
    center_code = integration_context.session.execute(
        text("SELECT center_code FROM centers WHERE is_active = true ORDER BY center_code LIMIT 1")
    ).scalar_one()
    batch_id = integration_context.session.execute(
        text(
            """
            INSERT INTO sample_import_batches (
                file_name, uploaded_by, total_rows, success_rows, failed_rows, import_type, status
            ) VALUES (
                'integration-storage.xlsx', :uploaded_by, 2, 2, 0, 'sample', 'imported'
            ) RETURNING id
            """
        ),
        {"uploaded_by": integration_context.admin.id},
    ).scalar_one()
    suffix = uuid4().hex[:8]
    sequence_start = int(uuid4().hex[:6], 16) % 9000 + 1000
    sample_rows: list[tuple[int, str, str]] = []
    for index, sample_status in enumerate(("not_stored", "checked_out"), start=1):
        sample_seq = f"991231{sequence_start + index:04d}"
        sample_code = f"{center_code}-{sample_seq}"
        sample_pk = integration_context.session.execute(
            text(
                """
                INSERT INTO samples (
                    sample_id, center_code, sample_seq, sample_code, specimen_type,
                    sample_status, created_by, updated_by
                ) VALUES (
                    :sample_id, :center_code, :sample_seq, :sample_code, '全血',
                    :sample_status, :operator_id, :operator_id
                ) RETURNING id
                """
            ),
            {
                "sample_id": f"IT-STORAGE-{suffix}-{index}",
                "center_code": center_code,
                "sample_seq": sample_seq,
                "sample_code": sample_code,
                "sample_status": sample_status,
                "operator_id": integration_context.admin.id,
            },
        ).scalar_one()
        integration_context.session.execute(
            text(
                """
                INSERT INTO sample_import_items (
                    import_batch_id, sample_pk, sample_code, row_number, action_type
                ) VALUES (:batch_id, :sample_pk, :sample_code, :row_number, 'created')
                """
            ),
            {
                "batch_id": batch_id,
                "sample_pk": sample_pk,
                "sample_code": sample_code,
                "row_number": index + 1,
            },
        )
        sample_rows.append((sample_pk, sample_code, sample_status))
    integration_context.session.commit()

    response = integration_context.client.post(f"/api/imports/batches/{batch_id}/confirm-storage")

    assert response.status_code == 200
    assert response.json()["stored_count"] == 1
    statuses = dict(
        integration_context.session.execute(
            text("SELECT id, sample_status FROM samples WHERE id = ANY(:sample_ids)"),
            {"sample_ids": [row[0] for row in sample_rows]},
        ).all()
    )
    assert statuses[sample_rows[0][0]] == "in_storage"
    assert statuses[sample_rows[1][0]] == "checked_out"
    movement_count = integration_context.session.execute(
        text(
            """
            SELECT count(*)
            FROM sample_movement_logs
            WHERE related_record_id = :batch_id
              AND action_type = 'import_batch_storage_confirm'
            """
        ),
        {"batch_id": batch_id},
    ).scalar_one()
    assert movement_count == 1


def test_scan_and_checkout_require_formal_sample_code(
    integration_context: IntegrationContext,
) -> None:
    suffix_number = uuid4().int % 10000
    sample_code = f"510115-001-991231{suffix_number:04d}"
    original_sample_id = f"RAW-{uuid4().hex[:10]}"
    integration_context.session.execute(
        text(
            """
            INSERT INTO samples (
                sample_id,
                sample_code,
                specimen_type,
                sample_status,
                created_by,
                updated_by
            )
            VALUES (
                :sample_id,
                :sample_code,
                '全血',
                'in_storage',
                :operator_id,
                :operator_id
            )
            """
        ),
        {
            "sample_id": original_sample_id,
            "sample_code": sample_code,
            "operator_id": integration_context.admin.id,
        },
    )
    integration_context.session.commit()

    raw_lookup = integration_context.client.get(
        f"/api/samples/{original_sample_id}",
        params={"lookup_by": "sample_code"},
    )
    assert raw_lookup.status_code == 200
    assert raw_lookup.json()["sample"] == {}

    raw_checkout = integration_context.client.post(
        f"/api/samples/{original_sample_id}/checkout",
        json={},
    )
    assert raw_checkout.status_code == 404

    formal_checkout = integration_context.client.post(
        f"/api/samples/{sample_code}/checkout",
        json={},
    )
    assert formal_checkout.status_code == 200
    assert formal_checkout.json()["sample_status"] == "checked_out"


def test_batch_confirm_rolls_back_every_change_when_one_record_is_invalid(
    integration_context: IntegrationContext,
) -> None:
    valid = seed_pending_dna_return(integration_context)
    invalid = seed_pending_dna_return(
        integration_context,
        sample_status="checked_out",
    )

    response = integration_context.client.post(
        "/api/returns/batch/confirm",
        json={
            "return_record_ids": [valid["return_id"], invalid["return_id"]],
            "final_status": "consumed",
        },
    )

    assert response.status_code == 409
    valid_state = integration_context.session.execute(
        text(
            """
            SELECT r.status AS return_status,
                   c.status AS checkout_status,
                   s.sample_status,
                   s.storage_location,
                   w.removed_at,
                   (
                       SELECT count(*)
                       FROM sample_movement_logs m
                       WHERE m.sample_pk = s.id
                         AND m.action_type = 'return_confirm'
                   ) AS movement_count
            FROM sample_return_records r
            JOIN sample_checkout_records c ON c.id = r.checkout_record_id
            JOIN samples s ON s.id = r.sample_pk
            JOIN sample_plate_wells w ON w.sample_pk = s.id
            WHERE r.id = :return_id
            """
        ),
        {"return_id": valid["return_id"]},
    ).mappings().one()
    assert valid_state["return_status"] == "pending"
    assert valid_state["checkout_status"] == "active"
    assert valid_state["sample_status"] == "return_pending"
    assert valid_state["storage_location"] == f"{valid['plate_code']} / A01"
    assert valid_state["removed_at"] is None
    assert valid_state["movement_count"] == 0


def test_terminal_return_releases_active_dna_well_through_api(
    integration_context: IntegrationContext,
) -> None:
    seeded = seed_pending_dna_return(integration_context)

    response = integration_context.client.post(
        f"/api/returns/{seeded['return_id']}/confirm",
        json={"final_status": "consumed"},
    )

    assert response.status_code == 200
    state = integration_context.session.execute(
        text(
            """
            SELECT r.status AS return_status,
                   r.final_status,
                   c.status AS checkout_status,
                   s.sample_status,
                   s.storage_location,
                   w.removed_at,
                   w.removed_by,
                   m.detail
            FROM sample_return_records r
            JOIN sample_checkout_records c ON c.id = r.checkout_record_id
            JOIN samples s ON s.id = r.sample_pk
            JOIN sample_plate_wells w ON w.sample_pk = s.id
            JOIN sample_movement_logs m
              ON m.sample_pk = s.id
             AND m.action_type = 'return_confirm'
            WHERE r.id = :return_id
            """
        ),
        {"return_id": seeded["return_id"]},
    ).mappings().one()
    assert state["return_status"] == "confirmed"
    assert state["final_status"] == "consumed"
    assert state["checkout_status"] == "returned"
    assert state["sample_status"] == "consumed"
    assert state["storage_location"] is None
    assert state["removed_at"] is not None
    assert state["removed_by"] == integration_context.admin.id
    assert state["detail"]["released_plate_well"] == {
        "plate_code": seeded["plate_code"],
        "well_code": "A01",
    }
