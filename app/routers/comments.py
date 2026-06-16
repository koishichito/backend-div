from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/quizzes/{quiz_id}/comments", tags=["comments"])


@router.get("", response_model=list[schemas.CommentRead])
def list_comments(quiz_id: int, db: Session = Depends(get_db)):
    if crud.get_quiz(db, quiz_id) is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return crud.list_comments(db, quiz_id)


@router.post(
    "", response_model=schemas.CommentRead, status_code=status.HTTP_201_CREATED
)
def create_comment(
    quiz_id: int,
    payload: schemas.CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if crud.get_quiz(db, quiz_id) is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return crud.create_comment(
        db, quiz_id=quiz_id, author_id=current_user.id, data=payload
    )
