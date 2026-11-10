# Vanish — Company Knowledge Handover

A local MVP for private, company-scoped employee knowledge handovers.

## What's included
- Company manager registration and private workspace creation
- Invitation codes for employees to join a specific company
- Email/password authentication with hashed passwords and JWT sessions
- Company-scoped employee, handover, answer, and knowledge APIs
- Role-based access: managers create/review handovers; employees answer their own handovers
- Three role-specific starter questions per handover
- Manager approval publishes answers to the company's knowledge library
- React + Vite frontend, FastAPI backend, PostgreSQL via Docker Compose

**Important:** This is a functional MVP starter, not a security-audited production service. Before real company use, add HTTPS, email delivery, rate limiting, audit logging, backups, monitoring, stronger invitation lifecycle controls, and a security review. Invitation codes are displayed to the manager so they can share them securely.

## Run locally

Requirements: Docker Desktop, Node.js 18+, Python 3.11+.

### 1. Start PostgreSQL
From the project root:
```bash
docker compose up -d db
```

### 2. Start the backend
```bash
cd backend
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
# Copy .env.example to .env and edit only if needed
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs

If PostgreSQL is not running, set `DATABASE_URL=sqlite:///./vanish.db` in `backend/.env` for a quick local test.

### 3. Start the frontend
In a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

The frontend expects the API at `http://localhost:8000`. Set `VITE_API_URL` if your API is elsewhere.

## First use
1. Select **Create company workspace** and register as the manager.
2. From the manager dashboard, create an employee invitation.
3. Share the invitation code with the employee.
4. Employee selects **Join a workspace**, enters the code, and creates an account.
5. Manager creates a handover for that employee.
6. Employee answers the three questions.
7. Manager reviews and approves. Approved answers appear in the company's Knowledge Library.

## Tenant isolation
Every protected database query is scoped using the authenticated user's `company_id`. Employees cannot request another company's employees, handovers, or knowledge through the API. Never remove these backend checks or rely on frontend hiding for security.

## Configuration
See `backend/.env.example`. Change `SECRET_KEY` before any deployment. Configure a production PostgreSQL database and HTTPS before exposing the service publicly.
