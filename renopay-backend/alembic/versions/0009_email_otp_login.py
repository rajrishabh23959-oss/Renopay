"""email otp login support
Revision ID: 0009
Revises: 0008
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Allow nullable phone_number so users can register and login via email OTP
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("phone_number", existing_type=sa.String(15), nullable=True)

    # 2. Add unique index on lower(email) for case-insensitive email identity isolation
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_lower_email ON users (lower(email)) WHERE email IS NOT NULL;"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_lower_email;")
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("phone_number", existing_type=sa.String(15), nullable=False)
