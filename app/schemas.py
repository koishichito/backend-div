from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: datetime


class QuizCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1)
    choices: list[str] = Field(min_length=2, max_length=10)
    answer_index: int = Field(ge=0)
    explanation: str | None = None

    @model_validator(mode="after")
    def validate_answer_index(self) -> "QuizCreate":
        if self.answer_index >= len(self.choices):
            raise ValueError("answer_index が choices の範囲外です")
        return self


class QuizRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    question: str
    choices: list[str]
    answer_index: int
    explanation: str | None
    created_at: datetime
    owner: UserRead


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    body: str
    created_at: datetime
    author: UserRead


class QuizReadWithComments(QuizRead):
    comments: list[CommentRead]
