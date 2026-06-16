from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .enums import QuizCategory


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    keycloak_sub: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    quizzes: Mapped[list["Quiz"]] = relationship(back_populates="owner")
    comments: Mapped[list["Comment"]] = relationship(back_populates="author")


class Quiz(Base):
    __tablename__ = "quizzes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    question: Mapped[str] = mapped_column(Text)
    choices: Mapped[list[str]] = mapped_column(JSON)
    answer_index: Mapped[int]
    explanation: Mapped[str | None] = mapped_column(Text)
    # カテゴリー(sns / internet / ai / java / python / html)。native_enum=False で
    # VARCHAR + CHECK 制約として表現するため、MySQL / SQLite どちらでも移植性がある。
    category: Mapped[QuizCategory] = mapped_column(
        Enum(QuizCategory, native_enum=False, length=20), index=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    owner: Mapped["User"] = relationship(back_populates="quizzes")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="quiz",
        cascade="all, delete-orphan",
        order_by="Comment.created_at",
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    quiz_id: Mapped[int] = mapped_column(
        ForeignKey("quizzes.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    quiz: Mapped["Quiz"] = relationship(back_populates="comments")
    author: Mapped["User"] = relationship(back_populates="comments")
