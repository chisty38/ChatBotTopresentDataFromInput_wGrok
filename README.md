CRM AI SQL (Groq)
=================

This repository is a minimal full-stack demo that converts natural language prompts to SQL (via Groq) and renders results in React.

Setup (quick):
1. Backend:
   cd backend
   cp .env.example .env
   # Edit backend/.env with GROQ_API_KEY and DB_* values
   npm install
   npm start

2. Create DB schema: run backend/schema.sql on your SQL Server.

3. Frontend:
   cd frontend
   npm install
   npm start

Notes:
- Keep your GROQ_API_KEY secret (use .env).
- The SQL validator allows only single SELECT/CTE statements to avoid DDL/DML.
