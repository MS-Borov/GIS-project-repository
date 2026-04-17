from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SubmissionCheck(Base):
    __tablename__ = "submission_checks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ВАЖНО: nullable=True
    # Потому что requirements-check может быть привязан ко всей submission,
    # если target GIS asset выбрать не удалось.
    submission_asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("submission_assets.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    status: Mapped[str] = mapped_column(String(50), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    submission = relationship("Submission", backref="checks")
    submission_asset = relationship("SubmissionAsset", backref="checks")