from pydantic import BaseModel, EmailStr, Field

class ManagerRegister(BaseModel):
    company_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

class EmployeeJoin(BaseModel):
    invitation_code: str
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

class Login(BaseModel):
    email: EmailStr
    password: str

class InviteCreate(BaseModel):
    email: EmailStr | None = None
    job_title: str = Field(default="General", max_length=100)

class HandoverCreate(BaseModel):
    employee_id: int | None = None
    role_category: str | None = None
    custom_questions: list[str] | None = None

class AnswerUpdate(BaseModel):
    answers: list[str]

class ReviewAction(BaseModel):
    action: str = Field(pattern="^(approve|request_changes)$")

class LogoutRequest(BaseModel):
    session_id: str | None = None
    reason: str | None = None

class UserOut(BaseModel):
    id: int
    company_id: int
    company_name: str
    name: str
    email: EmailStr
    role: str
    job_title: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
