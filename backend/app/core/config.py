from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "gis_platform"
    db_user: str = "postgres"
    db_password: str = "postgres"

    redis_host: str = "redis"
    redis_port: int = 6379

    jwt_access_secret: str = "change_me_access"
    jwt_refresh_secret: str = "change_me_refresh"

    environment: str = "development"
    log_level: str = "info"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()