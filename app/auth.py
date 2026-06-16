import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import crud, models
from .config import settings
from .database import get_db

ALGORITHM = "RS256"

bearer_scheme = HTTPBearer()

# JWKS は遅延取得・キャッシュされる(構築時にはフェッチしない)
jwks_client = jwt.PyJWKClient(settings.keycloak_jwks_url, cache_keys=True)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    token = credentials.credentials
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証情報が無効です",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[ALGORITHM],
            issuer=settings.keycloak_issuer,
            audience=settings.keycloak_audience,
            options={
                "verify_aud": settings.keycloak_audience is not None,
                "require": ["exp", "sub"],
            },
        )
    except jwt.PyJWTError:
        raise credentials_error

    username = payload.get("preferred_username") or payload["sub"]
    return crud.get_or_create_user(db, keycloak_sub=payload["sub"], username=username)
