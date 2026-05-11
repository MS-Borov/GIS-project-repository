from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "gis_platform"
    db_user: str = "postgres"
    db_password: str = "postgres"

    s3_endpoint: str = "minio:9000"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket_name: str = "submissions"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    redis_url: str = "redis://redis:6379/0"

    # cerebras_relay | ollama
    llm_backend: str = "cerebras_relay"
    openai_api_key: str | None = None

    # Cerebras relay
    cerebras_model: str = "llama3.1-8b"
    cerebras_relay_url: str = "http://host.docker.internal:8788/chat"

    # Локальный fallback можно оставить
    llm_base_url: str = "http://host.docker.internal:11434"
    llm_model: str = "qwen3.5:2b"

    auth_secret_key: str = "change-me-in-production"
    auth_access_token_expire_minutes: int = 60 * 24
    rate_limit_enabled: bool = True

    ai_digitizer_url: str = "http://ai-digitizer:8790"
    ai_digitizer_timeout_seconds: int = 45

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
