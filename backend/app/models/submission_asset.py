from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SubmissionAsset(Base):
    __tablename__ = "submission_assets"

    # Уникальный ID записи в БД
    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # К какой submission относится этот asset
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Имя файла или логическое имя слоя внутри архива
    asset_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Тип asset:
    # report / layer / other
    asset_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Какой формат был определён:
    # geojson / shapefile_zip / docx / txt / unknown
    detected_format: Mapped[str] = mapped_column(String(50), nullable=False)

    # Итог статуса первичной проверки:
    # passed / warning / failed
    status: Mapped[str] = mapped_column(String(50), nullable=False)

    # Краткое пояснение результата проверки
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Время создания записи
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    submission = relationship("Submission", backref="assets")