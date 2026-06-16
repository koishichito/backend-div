import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401
from .database import Base, engine
from .routers import auth, comments, quizzes


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時にテーブルを作成(存在しなければ)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Quiz SNS API",
    lifespan=lifespan,
    # リバースプロキシ配下に置く場合のみ ROOT_PATH を設定(例: /proxy/8099)。
    # 直接公開する場合は未設定(空文字)でよい。
    root_path=os.getenv("ROOT_PATH", ""),
)

# CORS 許可オリジンは環境変数でカンマ区切り指定可。既定はローカル開発用。
_cors_origins = os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
)
allow_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(quizzes.router)
app.include_router(comments.router)


@app.get("/")
def health_check():
    return {"status": "ok"}
