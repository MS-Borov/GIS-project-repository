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

    # --- LLM config ---
    # ollama | openai
    llm_backend: str = "ollama"

    # Для Ollama:
    # контейнер backend будет ходить на хост по host.docker.internal
    llm_base_url: str = "http://host.docker.internal:11434"
    llm_model: str = "qwen2.5:3b"

    # Эти поля можно оставить на будущее,
    # если захочешь снова подключить облачный API.
    openai_api_key: str | None = None
    openai_base_url: str | None = None

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()