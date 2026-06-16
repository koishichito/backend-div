from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


@router.get("", response_model=list[schemas.QuizRead])
def list_quizzes(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return crud.list_quizzes(db, skip=skip, limit=limit)


@router.post("", response_model=schemas.QuizRead, status_code=status.HTTP_201_CREATED)
def create_quiz(
    payload: schemas.QuizCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.create_quiz(db, payload, owner_id=current_user.id)


@router.get("/{quiz_id}", response_model=schemas.QuizReadWithComments)
def get_quiz(quiz_id: int, db: Session = Depends(get_db)):
    quiz = crud.get_quiz_with_details(db, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "クイズが見つかりません")
    return quiz


@router.delete("/{quiz_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quiz(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    quiz = crud.get_quiz(db, quiz_id)
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "クイズが見つかりません")
    if quiz.owner_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "自分のクイズしか削除できません")
    crud.delete_quiz(db, quiz)
