from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import models, schemas


def get_user_by_sub(db: Session, keycloak_sub: str) -> models.User | None:
    return db.scalars(
        select(models.User).where(models.User.keycloak_sub == keycloak_sub)
    ).first()


def get_or_create_user(db: Session, *, keycloak_sub: str, username: str) -> models.User:
    user = get_user_by_sub(db, keycloak_sub)

    if user is None:
        user = models.User(keycloak_sub=keycloak_sub, username=username)
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            # 競合で別リクエストが先に作成済みの場合に備える
            db.rollback()
            user = get_user_by_sub(db, keycloak_sub)
        else:
            db.refresh(user)
        return user

    if user.username != username:
        # Keycloak 側で username が変わっていれば同期
        user.username = username
        db.commit()
        db.refresh(user)
    return user


def create_quiz(db: Session, data: schemas.QuizCreate, owner_id: int) -> models.Quiz:
    quiz = models.Quiz(**data.model_dump(), owner_id=owner_id)
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def list_quizzes(db: Session, skip: int = 0, limit: int = 20) -> list[models.Quiz]:
    stmt = (
        select(models.Quiz)
        .options(selectinload(models.Quiz.owner))
        .order_by(models.Quiz.created_at.desc(), models.Quiz.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def get_quiz(db: Session, quiz_id: int) -> models.Quiz | None:
    return db.get(models.Quiz, quiz_id)


def get_quiz_with_details(db: Session, quiz_id: int) -> models.Quiz | None:
    stmt = (
        select(models.Quiz)
        .where(models.Quiz.id == quiz_id)
        .options(
            selectinload(models.Quiz.owner),
            selectinload(models.Quiz.comments).selectinload(models.Comment.author),
        )
    )
    return db.scalars(stmt).first()


def delete_quiz(db: Session, quiz: models.Quiz) -> None:
    db.delete(quiz)
    db.commit()


def create_comment(
    db: Session, quiz_id: int, author_id: int, data: schemas.CommentCreate
) -> models.Comment:
    comment = models.Comment(quiz_id=quiz_id, author_id=author_id, body=data.body)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


def list_comments(db: Session, quiz_id: int) -> list[models.Comment]:
    stmt = (
        select(models.Comment)
        .where(models.Comment.quiz_id == quiz_id)
        .options(selectinload(models.Comment.author))
        .order_by(models.Comment.created_at.asc(), models.Comment.id.asc())
    )
    return list(db.scalars(stmt).all())
