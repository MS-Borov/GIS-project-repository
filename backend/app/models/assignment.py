from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    course = relationship("Course", back_populates="assignments")

    # Обратная сторона one-to-one связи с AssignmentRequirements
    requirements = relationship(
        "AssignmentRequirements",
        back_populates="assignment",
        uselist=False,
        cascade="all, delete-orphan",
    )
