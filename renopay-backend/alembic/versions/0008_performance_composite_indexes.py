"""performance composite indexes

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Justification: Accelerates paginated transaction history queries by eliminating in-memory sorting across account records.
    op.create_index(
        "ix_transactions_account_id_created_at",
        "transactions",
        ["account_id", sa.text("created_at DESC")],
        if_not_exists=True,
    )

    # 2. Justification: Optimizes corporate journal queries filtered by account and sorted by timestamp.
    op.create_index(
        "ix_journal_entries_account_id_created_at",
        "journal_entries",
        ["account_id", sa.text("created_at DESC")],
        if_not_exists=True,
    )

    # 3. Justification: Speeds up shopkeeper customer lists filtered by merchant and ordered by latest transaction activity.
    op.create_index(
        "ix_khatabook_customers_merchant_updated",
        "khatabook_customers",
        ["merchant_user_id", sa.text("updated_at DESC")],
        if_not_exists=True,
    )

    # 4. Justification: Accelerates monthly business turnover and sales report queries by merchant and date range.
    op.create_index(
        "ix_khatabook_entries_merchant_entry_date",
        "khatabook_entries",
        ["merchant_user_id", sa.text("entry_date DESC")],
        if_not_exists=True,
    )

    # 5. Justification: Ensures O(1) membership lookups and prevents duplicate memberships in shared vaults.
    op.create_index(
        "ix_shared_vault_members_vault_user",
        "shared_vault_members",
        ["vault_id", "user_id"],
        unique=True,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_shared_vault_members_vault_user", table_name="shared_vault_members", if_exists=True)
    op.drop_index("ix_khatabook_entries_merchant_entry_date", table_name="khatabook_entries", if_exists=True)
    op.drop_index("ix_khatabook_customers_merchant_updated", table_name="khatabook_customers", if_exists=True)
    op.drop_index("ix_journal_entries_account_id_created_at", table_name="journal_entries", if_exists=True)
    op.drop_index("ix_transactions_account_id_created_at", table_name="transactions", if_exists=True)
