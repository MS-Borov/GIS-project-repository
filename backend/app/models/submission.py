from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, BigInteger, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    status: Mapped[str] = mapped_column(String(50), nullable=False, default="uploaded")

    # Решение преподавателя по сдаче (отдельно от авто-проверки `status`):
    #   pending  — сдано, ждёт проверки (по умолчанию);
    #   returned — возвращено студенту на переделку (задание снова видно у студента);
    #   accepted — принято преподавателем.
    review_status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")

    # Комментарий преподавателя к сдаче (замечания, что исправить при возврате).
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    assignment = relationship("Assignment", backref="submissions")
    student = relationship("User", backref="submissions")