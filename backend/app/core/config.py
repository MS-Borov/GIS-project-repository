from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "gis_platform"
    db_user: str = "postgres"
    db_password: str = "postgres"
    db_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 1800

    # Лимиты на загружаемые файлы. Жёсткий потолок — nginx client_max_body_size.
    # Здесь — backend-уровень: даём 413 раньше чем съедим память.
    max_document_upload_bytes: int = 30 * 1024 * 1024   # 30 MB — для DOCX/PDF
    max_archive_upload_bytes: int = 100 * 1024 * 1024   # 100 MB — для ZIP-архивов сдач/материалов

    # Защита от ZIP-bomb: сжатый 100 MB может распаковаться в гигабайты.
    # Этот лимит = сумма uncompressed size всех членов архива.
    # 500 MB разрешает реальные shapefile'ы с пожатыми геоданными
    # (типичный compression ratio для .shp/.dbf ~3-5x), но режет бомбы.
    max_archive_uncompressed_bytes: int = 500 * 1024 * 1024  # 500 MB

    s3_endpoint: str = "minio:9000"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket_name: str = "submissions"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    redis_url: str = "redis://redis:6379/0"

    # cerebras_relay | openrouter | ollama
    llm_backend: str = "cerebras_relay"
    openai_api_key: str | None = None

    # Cerebras relay
    cerebras_model: str = "llama3.1-8b"
    cerebras_relay_url: str = "http://host.docker.internal:8788/chat"

    # OpenRouter. Use a :free model for zero-cost multimodal testing.
    openrouter_api_key: str | None = None
    openrouter_model: str = "google/gemma-4-31b-it:free"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Локальный fallback можно оставить
    llm_base_url: str = "http://host.docker.internal:11434"
    llm_model: str = "qwen3.5:2b"

    auth_secret_key: str = "change-me-in-production"
    auth_access_token_expire_minutes: int = 60 * 24
    rate_limit_enabled: bool = True

    email_verification_required: bool = False
    email_verification_code_ttl_minutes: int = 20
    email_verification_resend_seconds: int = 60
    email_verification_dev_return_code: bool = False

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "GIS Education Platform"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 15

    ai_digitizer_url: str = "http://ai-digitizer:8790"
    ai_digitizer_timeout_seconds: int = 45

    # Корзина заданий: сколько дней удалённое задание лежит восстановимым,
    # прежде чем фоновая задача удалит его физически (вместе со сдачами).
    assignment_trash_retention_days: int = 7

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()