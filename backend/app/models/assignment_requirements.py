from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class AssignmentRequirements(Base):
    __tablename__ = "assignment_requirements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    source_doc_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # How the whole student work is submitted: usually one archive with report + GIS files.
    submission_format: Mapped[str | None] = mapped_column(String(100), default="archive", nullable=True)

    deliverable_format: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expected_geometry_types: Mapped[list | None] = mapped_column(JSON, nullable=True)
    expected_crs: Mapped[str | None] = mapped_column(String(100), nullable=True)
    required_attributes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    topology_rules: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Новый ключевой блок: список ожидаемых выходных слоёв
    expected_outputs_json: Mapped[list | None] = mapped_column(JSON, nullable=True)

    needs_reference_layer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    report_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_checkable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    extraction_status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    extraction_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    assignment = relationship("Assignment", back_populates="requirements")
