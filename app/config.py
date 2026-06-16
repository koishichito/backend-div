from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # DB サーバ(本番=53 番)。既定はローカル開発用。
    database_url: str = (
        "mysql+pymysql://quiz_user:quiz_pass@localhost:3306/quiz_db?charset=utf8mb4"
    )

    # Keycloak サーバ(本番=51 番)。
    # トークン検証の issuer / JWKS URL はこの値から導出される。
    keycloak_server_url: str = "http://localhost:8080/"

    # フロントエンド等がブラウザ経由でトークンを取得する際の公開 URL。
    # バックエンドのトークン検証では使用しない(参考用プロパティのみ)。
    keycloak_public_url: str = "http://localhost:8080"

    keycloak_realm: str = "test"
    keycloak_client_id: str = "test"

    # 既定では aud を検証しない。
    # Keycloak 既定の access token は aud="account" のため、ここに client_id 等を
    # 設定すると aud 検証に失敗する。検証したい場合は Keycloak 側に Audience mapper
    # を追加すること。
    keycloak_audience: str | None = None

    @property
    def keycloak_issuer(self) -> str:
        return f"{self.keycloak_server_url.rstrip('/')}/realms/{self.keycloak_realm}"

    @property
    def keycloak_jwks_url(self) -> str:
        return f"{self.keycloak_issuer}/protocol/openid-connect/certs"

    @property
    def keycloak_token_url(self) -> str:
        return f"{self.keycloak_issuer}/protocol/openid-connect/token"

    @property
    def keycloak_token_url_public(self) -> str:
        return (
            f"{self.keycloak_public_url.rstrip('/')}"
            f"/realms/{self.keycloak_realm}/protocol/openid-connect/token"
        )


settings = Settings()
