import secrets
import re
import json
from datetime import datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_
from .database import Base, engine, get_db
from .models import Company, User, Invitation, Handover, HandoverQuestion, KnowledgeItem, EmployeeActivity, Notification
from .schemas import ManagerRegister, EmployeeJoin, Login, InviteCreate, HandoverCreate, AnswerUpdate, ReviewAction, LogoutRequest
from .security import hash_password, verify_password, create_token, current_user, manager_only
from .config import settings

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Vanish API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

ROLE_QUESTIONS = {
    "general": [
        "What are the most important responsibilities and workflows you handle each week?",
        "Which tools, documents, systems, or accounts does someone need to take over your work?",
        "What common problems, ongoing tasks, or tips should the next person know how to handle?"
    ],
    "engineering": [
        "Which services, repositories, environments, and deployment steps do you own?",
        "What recurring technical issues, hidden dependencies, or architectural gotchas should the next engineer know?",
        "Where are the runbooks, tests, credentials/access procedures, and architecture decisions documented?"
    ],
    "sales": [
        "Which active customer relationships, pipelines, and deals need attention?",
        "What customer context, commitments, pricing notes, and follow-up dates must be carried forward?",
        "Which sales tools, CRM processes, and qualification rules are essential to your work?"
    ],
    "design": [
        "Where are the source files, design systems, component libraries, and current project assets?",
        "What design decisions, user research findings, or open feedback should the next designer understand?",
        "Which review, developer handoff, and publishing processes do you follow?"
    ],
    "marketing": [
        "Which campaigns, channels, ad accounts, and content calendars are currently active?",
        "What audience insights, brand rules, and performance learnings should be preserved?",
        "Which marketing tools, vendors, approvals, and upcoming launch deadlines need attention?"
    ],
    "operations": [
        "Which recurring workflows, vendor relationships, and operational checklists do you own?",
        "What suppliers, contacts, schedules, or exceptions should the next person know?",
        "What operational risks, compliance requirements, or recurring bottlenecks require monitoring?"
    ],
    "hr": [
        "Which people processes, employee cases, or recruiting pipelines need continuity?",
        "Where are the relevant policies, templates, contracts, and confidential records stored?",
        "What upcoming deadlines, renewals, approvals, or stakeholder conversations need follow-up?"
    ],
    "product": [
        "What features, user stories, roadmaps, or sprint priorities are currently in progress?",
        "Where are PRDs, research data, backlog items, and product metrics tracked?",
        "Which cross-functional stakeholders and dependencies need coordinated handoff?"
    ],
    "finance": [
        "Which accounts, budgets, vendor invoices, or tax filings require upcoming action?",
        "Where are financial models, banking/accounting portals, and spreadsheets located?",
        "What recurring monthly/quarterly closing procedures and compliance deadlines must be maintained?"
    ]
}

ROLE_PATTERNS = {
    "engineering": [r"\bengineer", r"\bdeveloper", r"\bdev\b", r"\bsoftware", r"\btech", r"\barchitect", r"\bprogrammer", r"\bdevops\b", r"\bsre\b", r"\bqa\b", r"\bfrontend\b", r"\bbackend\b", r"\bfullstack\b", r"\bdata\b"],
    "design": [r"\bdesign", r"\bui\b", r"\bux\b", r"\bgraphic", r"\bcreative\b", r"\bartist\b", r"\billustrat"],
    "product": [r"\bproduct\b", r"\bscrum\b", r"\bagile\b", r"\bproject manager", r"\bprogram manager"],
    "sales": [r"\bsales\b", r"\baccount exec", r"\baccount manager", r"\bbd\b", r"\bbusiness dev", r"\bdeal", r"\brevenue\b"],
    "marketing": [r"\bmarket", r"\bgrowth\b", r"\bseo\b", r"\bcontent\b", r"\bsocial media\b", r"\bbrand", r"\bcopywrit", r"\bcampaign"],
    "finance": [r"\bfinanc", r"\baccountant", r"\baccounting\b", r"\bbilling\b", r"\bpayroll\b", r"\baudit", r"\btreasury\b", r"\bbookkeep"],
    "hr": [r"\bhr\b", r"\bhuman resource", r"\btalent\b", r"\brecruit", r"\bpeople\b", r"\bculture\b"],
    "operations": [r"\boperat", r"\bops\b", r"\blogistics\b", r"\bsupply\b", r"\badmin", r"\boffice manager", r"\bcoordinator\b"]
}

def get_questions_for_role(job_title: str) -> list[str]:
    title_lower = (job_title or "").lower()
    for role, patterns in ROLE_PATTERNS.items():
        if any(re.search(p, title_lower) for p in patterns):
            return ROLE_QUESTIONS[role]
    return ROLE_QUESTIONS["general"]

def user_payload(user: User, db: Session):
    company = db.query(Company).filter(Company.id == user.company_id).first()
    return {"id": user.id, "company_id": user.company_id, "company_name": company.name if company else "", "name": user.name, "email": user.email, "role": user.role, "job_title": user.job_title}

def token_response(user: User, db: Session, request: Request = None):
    session_id = secrets.token_urlsafe(16)
    client_ip = request.client.host if (request and request.client) else None
    ua = request.headers.get("user-agent", "Browser Session")[:150] if request else "Browser Session"
    activity = EmployeeActivity(
        company_id=user.company_id,
        user_id=user.id,
        session_id=session_id,
        ip_address=client_ip,
        device_info=ua
    )
    db.add(activity)
    db.commit()
    return {"access_token": create_token(user), "token_type": "bearer", "session_id": session_id, "user": user_payload(user, db)}

def handover_payload(h: Handover):
    return {"id": h.id, "employee_id": h.employee_id, "employee_name": h.employee.name, "employee_email": h.employee.email, "job_title": h.employee.job_title, "status": h.status, "created_at": h.created_at.isoformat(), "questions": [{"id": q.id, "prompt": q.prompt, "answer": q.answer} for q in h.questions]}

def notification_payload(n: Notification, current_user_id: int):
    denied_ids = []
    try:
        denied_ids = json.loads(n.denied_by_ids or "[]")
    except Exception:
        denied_ids = []
    return {
        "id": n.id,
        "company_id": n.company_id,
        "sender_id": n.sender_id,
        "sender_name": n.sender.name if n.sender else "Team Member",
        "sender_job_title": n.sender.job_title if n.sender else "General",
        "handover_id": n.handover_id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "status": n.status,
        "claimed_by_id": n.claimed_by_id,
        "claimed_by_name": n.claimed_by.name if n.claimed_by else None,
        "claimed_at": n.claimed_at.isoformat() if n.claimed_at else None,
        "is_claimed_by_me": (n.claimed_by_id == current_user_id),
        "is_denied_by_me": (current_user_id in denied_ids),
        "can_accept": (n.status == "open" and current_user_id not in denied_ids),
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }

@app.get("/")
def root():
    return {"service": "Vanish API", "status": "running"}

@app.post("/auth/register")
def register(data: ManagerRegister, request: Request, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "An account with this email already exists")
    company = Company(name=data.company_name.strip())
    db.add(company); db.flush()
    user = User(company_id=company.id, name=data.name.strip(), email=email, password_hash=hash_password(data.password), role="manager", job_title="Manager")
    db.add(user); db.commit(); db.refresh(user)
    return token_response(user, db, request)

@app.post("/auth/join")
def join(data: EmployeeJoin, request: Request, db: Session = Depends(get_db)):
    invitation = db.query(Invitation).filter(Invitation.code == data.invitation_code.strip(), Invitation.used.is_(False)).first()
    if not invitation:
        raise HTTPException(400, "Invitation code is invalid or already used")
    email = data.email.lower()
    if invitation.email and invitation.email.lower() != email:
        raise HTTPException(403, "This invitation was issued to a different email address")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "An account with this email already exists")
    user = User(company_id=invitation.company_id, name=data.name.strip(), email=email, password_hash=hash_password(data.password), role="employee", job_title=invitation.job_title)
    invitation.used = True
    db.add(user); db.commit(); db.refresh(user)
    return token_response(user, db, request)

@app.post("/auth/login")
def login(data: Login, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    return token_response(user, db, request)

@app.post("/auth/logout")
def logout_endpoint(data: LogoutRequest = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(EmployeeActivity).filter(
        EmployeeActivity.user_id == user.id,
        EmployeeActivity.logout_at.is_(None)
    )
    if data and data.session_id:
        activity = query.filter(EmployeeActivity.session_id == data.session_id).first()
    else:
        activity = query.order_by(EmployeeActivity.login_at.desc()).first()

    reason = data.reason if (data and data.reason) else "User logged out"
    if activity:
        activity.logout_at = datetime.now(timezone.utc)
        activity.logout_reason = reason
        db.commit()

    if user.role == "employee":
        notif = Notification(
            company_id=user.company_id,
            sender_id=user.id,
            type="logout",
            title=f"Employee Departure: {user.name} ({user.job_title})",
            message=f"{user.name} has signed out ({reason}). Work items are open for team takeover.",
            status="open",
            denied_by_ids="[]"
        )
        db.add(notif)
        db.commit()

    return {"status": "logged_out"}

@app.post("/auth/logout-beacon")
def logout_beacon(data: LogoutRequest = None, db: Session = Depends(get_db)):
    if data and data.session_id:
        activity = db.query(EmployeeActivity).filter(
            EmployeeActivity.session_id == data.session_id,
            EmployeeActivity.logout_at.is_(None)
        ).first()
        if activity:
            activity.logout_at = datetime.now(timezone.utc)
            activity.logout_reason = data.reason or "Browser closed"
            db.commit()
            if activity.user and activity.user.role == "employee":
                notif = Notification(
                    company_id=activity.company_id,
                    sender_id=activity.user_id,
                    type="logout",
                    title=f"Employee Departure: {activity.user.name} ({activity.user.job_title})",
                    message=f"{activity.user.name} has signed out ({activity.logout_reason}). Work items are open for team takeover.",
                    status="open",
                    denied_by_ids="[]"
                )
                db.add(notif)
                db.commit()
            return {"status": "logged_out"}
    return {"status": "ok"}

@app.get("/auth/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_payload(user, db)

@app.get("/activity")
def get_activity_log(user: User = Depends(manager_only), db: Session = Depends(get_db)):
    rows = (
        db.query(EmployeeActivity)
        .filter(EmployeeActivity.company_id == user.company_id)
        .order_by(EmployeeActivity.login_at.desc())
        .limit(250)
        .all()
    )
    return [
        {
            "id": a.id,
            "session_id": a.session_id,
            "user_id": a.user_id,
            "employee_name": a.user.name if a.user else "Deleted user",
            "employee_email": a.user.email if a.user else "",
            "job_title": a.user.job_title if a.user else "Employee",
            "role": a.user.role if a.user else "employee",
            "login_at": a.login_at.isoformat() if a.login_at else None,
            "logout_at": a.logout_at.isoformat() if a.logout_at else None,
            "logout_reason": a.logout_reason or ("In session" if a.logout_at is None else "Signed out"),
            "is_active": a.logout_at is None,
            "device_info": a.device_info or "Web Browser"
        }
        for a in rows
    ]

@app.get("/employees")
def employees(user: User = Depends(manager_only), db: Session = Depends(get_db)):
    rows = db.query(User).filter(User.company_id == user.company_id, User.role == "employee", User.active.is_(True)).order_by(User.name).all()
    return [{"id": x.id, "name": x.name, "email": x.email, "job_title": x.job_title} for x in rows]

@app.post("/invitations")
def create_invitation(data: InviteCreate, user: User = Depends(manager_only), db: Session = Depends(get_db)):
    code = secrets.token_urlsafe(9)
    inv = Invitation(company_id=user.company_id, code=code, email=data.email.lower() if data.email else None, job_title=data.job_title.strip() or "General")
    db.add(inv); db.commit()
    return {"code": code, "email": inv.email, "job_title": inv.job_title, "join_path": "/"}

@app.get("/handover-templates")
def handover_templates():
    return ROLE_QUESTIONS

@app.post("/handovers")
def create_handover(data: HandoverCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    target_id = data.employee_id or user.id
    if user.role != "manager" and target_id != user.id:
        raise HTTPException(403, "Employees can only initiate their own handover")
    employee = db.query(User).filter(User.id == target_id, User.company_id == user.company_id, User.role == "employee").first()
    if not employee:
        raise HTTPException(404, "Employee not found in your workspace")
    active = db.query(Handover).filter(Handover.employee_id == employee.id, Handover.company_id == user.company_id, Handover.status.in_(["pending", "submitted", "changes_requested"])).first()
    if active:
        raise HTTPException(409, "This employee already has an active handover")

    if data.custom_questions and len(data.custom_questions) == 3 and all(q.strip() for q in data.custom_questions):
        prompts = [q.strip() for q in data.custom_questions]
    elif data.role_category and data.role_category in ROLE_QUESTIONS:
        prompts = ROLE_QUESTIONS[data.role_category]
    else:
        prompts = get_questions_for_role(employee.job_title)

    h = Handover(company_id=user.company_id, employee_id=employee.id, created_by_id=user.id, status="pending")
    db.add(h); db.flush()
    for prompt in prompts:
        db.add(HandoverQuestion(handover_id=h.id, prompt=prompt))
    db.commit(); db.refresh(h)
    return handover_payload(h)

@app.get("/handovers")
def list_handovers(user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Handover).filter(Handover.company_id == user.company_id)
    if user.role == "employee":
        query = query.filter(Handover.employee_id == user.id)
    rows = query.order_by(Handover.created_at.desc()).all()
    return [handover_payload(h) for h in rows]

@app.put("/handovers/{handover_id}/answers")
def submit_answers(handover_id: int, data: AnswerUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.query(Handover).filter(Handover.id == handover_id, Handover.company_id == user.company_id, Handover.employee_id == user.id).first()
    if not h:
        raise HTTPException(404, "Handover not found")
    if h.status not in ["pending", "changes_requested"]:
        raise HTTPException(409, "This handover is not accepting answers")
    if len(data.answers) != len(h.questions):
        raise HTTPException(400, "Please answer all three questions")
    for question, answer in zip(h.questions, data.answers):
        question.answer = answer.strip()
    h.status = "submitted"
    db.commit()

    emp = h.employee
    notif = Notification(
        company_id=user.company_id,
        sender_id=user.id,
        handover_id=h.id,
        type="handover",
        title=f"Work Handover: {emp.name} ({emp.job_title})",
        message=f"{emp.name} has submitted their complete 3-question work handover before leaving. Responsibilities are open for takeover.",
        status="open",
        denied_by_ids="[]"
    )
    db.add(notif)
    db.commit()
    return handover_payload(h)

@app.post("/handovers/{handover_id}/review")
def review(handover_id: int, data: ReviewAction, user: User = Depends(manager_only), db: Session = Depends(get_db)):
    h = db.query(Handover).filter(Handover.id == handover_id, Handover.company_id == user.company_id).first()
    if not h:
        raise HTTPException(404, "Handover not found")
    if h.status != "submitted":
        raise HTTPException(409, "Only submitted handovers can be reviewed")
    if data.action == "request_changes":
        h.status = "changes_requested"
    else:
        if any(not q.answer or not q.answer.strip() for q in h.questions):
            raise HTTPException(400, "All answers must be completed before approval")
        h.status = "approved"
        h.reviewed_at = datetime.now(timezone.utc)
        content = "\n\n".join(f"{q.prompt}\n{q.answer}" for q in h.questions)
        existing = db.query(KnowledgeItem).filter(KnowledgeItem.handover_id == h.id, KnowledgeItem.company_id == user.company_id).first()
        if not existing:
            db.add(KnowledgeItem(company_id=user.company_id, handover_id=h.id, employee_name=h.employee.name, title=f"{h.employee.job_title} handover — {h.employee.name}", content=content))
    db.commit()
    return handover_payload(h)

@app.get("/knowledge")
def knowledge(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(KnowledgeItem).filter(KnowledgeItem.company_id == user.company_id).order_by(KnowledgeItem.created_at.desc()).all()
    return [{"id": x.id, "title": x.title, "employee_name": x.employee_name, "content": x.content, "created_at": x.created_at.isoformat()} for x in rows]

@app.get("/notifications")
def get_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Notification)
        .filter(Notification.company_id == user.company_id)
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    )
    return [notification_payload(n, user.id) for n in rows]

@app.post("/notifications/{notification_id}/accept")
def accept_notification(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.company_id == user.company_id).first()
    if not n:
        raise HTTPException(404, "Notification not found")
    if n.status == "claimed":
        claimed_name = n.claimed_by.name if n.claimed_by else "another employee"
        raise HTTPException(409, f"This work handover has already been accepted by {claimed_name}")
    
    n.status = "claimed"
    n.claimed_by_id = user.id
    n.claimed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(n)
    return notification_payload(n, user.id)

@app.post("/notifications/{notification_id}/deny")
def deny_notification(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.company_id == user.company_id).first()
    if not n:
        raise HTTPException(404, "Notification not found")
    
    denied_ids = []
    try:
        denied_ids = json.loads(n.denied_by_ids or "[]")
    except Exception:
        denied_ids = []
    if user.id not in denied_ids:
        denied_ids.append(user.id)
        n.denied_by_ids = json.dumps(denied_ids)
        db.commit()
        db.refresh(n)
    return notification_payload(n, user.id)
