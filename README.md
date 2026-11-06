# IT Help Desk: Dar El Salam

A standalone ticketing system for **IT problems and IT requests only**. Employees raise tickets, the IT team works them, managers approve purchases and joiner/leaver requests, and an admin controls everything from an Admin Console. It is fully bilingual (English / Arabic, right-to-left).

This system is **completely independent of Taskflow**:
- its own code (this repository)
- its own database
- its own website address
- its own sign-in
- its own users and departments
- its own email mailbox

Nothing is shared, so changes in one can never affect the other.

> Going live? Follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**: Supabase, Zoho Mail, Zoho sign-in, Vercel and your domain, step by step.

---

## PART 1: For everyone (plain language)

### Who uses it
| Role | Sees | Can do |
|---|---|---|
| 👤 **Employee** | Help Center, My Requests, Knowledge Base | Search quick fixes, raise tickets, chat with IT, confirm and rate a fix, reopen if still broken |
| 🛠️ **IT Agent** | Ticket Queue, My Requests, Knowledge Base | Take tickets, reply, write private notes, change status/priority, resolve |
| 👑 **IT Manager** | Everything an agent sees, plus Dashboard, Approvals, Auto-assignment | Approve or reject requests, declare a major incident |
| 🛡️ **Admin** | Admin Console, plus everything above | Manage people, departments, categories, questions, priorities, statuses, replies, articles and settings |
| *Any manager* | Approvals (when someone they manage asks for something) | Approve or reject that person's requests |

### Help categories
Request Hardware · Internet & Connectivity · Email & Accounts · New Software / License Purchase *(needs approval)* · New Joiner / Leaver *(needs approval)* · Something Else.
Admins can rename, reorder, hide, add or remove categories and change their questions.

### How a ticket moves
1. The employee searches first. Matching how-to articles appear and may solve it right away.
2. The employee picks a category and answers its short questions, plus *"Who is affected?"* and *"How urgent is it?"*. These set the priority (P1–P4).
3. The ticket goes automatically to the person who owns that category.
4. Software and joiner/leaver requests first wait for the **employee's manager** to approve.
5. IT replies (or writes private notes), then marks the ticket resolved with a note on the fix.
6. The employee confirms and rates it, or reopens it.

### Emails
| When | Who gets an email |
|---|---|
| **Any new ticket** | **The IT support mailbox (`support@company.com`), always.** Also the employee (confirmation) and the assigned IT person, or the approver. |
| IT replies | The employee |
| The employee replies | The assigned IT person (or support if nobody is assigned) |
| Assigned / approved / rejected / resolved / reopened | The people involved |

Every email is in Arabic and English and is recorded in a log.

### Signing in
- People sign in with their **Zoho work account**.
- Anyone with a company email address is added automatically the first time they sign in, as an Employee.
- The admin then sets their department, manager and role.
- Turning someone off in the Admin Console signs them out immediately.

---

## PART 2: For developers

### Architecture
| Part | What it is |
|---|---|
| `index.html` | The whole interface. React 18 (UMD from cdnjs), `React.createElement`, no build step. English/Arabic through an `S` dictionary and `t()`; RTL via `dir="rtl"` and logical CSS properties. Language is remembered in `localStorage.ithd_lang`. |
| `api/app.js` | The API: `POST /api/app { action, … }`. Identity always comes from the session cookie. |
| `api/auth-login.js` → `api/auth-callback.js` | Zoho OAuth sign-in with a `state` check. Creates or updates the user and starts a session. |
| `api/auth-logout.js` | Ends the session. |
| `api/_core.js` | Defaults (categories, priorities, statuses…), permissions, config loading/seeding, ticket shaping, bilingual email texts |
| `api/_session.js` | Sessions: random 64-hex token in the HttpOnly `ithd_session` cookie, 12 hours |
| `api/_email.js` | SMTP sending via nodemailer, HTML-escaped bilingual template, writes `email_log` |
| `api/_db.js` | Supabase client using the service key, server-side only |
| `schema.sql` | All tables. RLS is on with no policies, so only the server (service key) can read or write. |
| `tests/run.js` | End-to-end tests (see below) |

Files starting with `_` are helpers, not endpoints. The app uses **4 serverless functions**.

### API actions
- **Read:** `bootstrap`, `list-tickets`, `kb-view`
- **Tickets:** `create-ticket`, `reply`, `update-ticket` (assignee / status / priority / major), `resolve`, `confirm`, `reopen`, `approve`, `reject`
- **Admin:** `admin-save-user`, `admin-save-dept`, `admin-delete-dept`, `admin-save-settings`, `admin-save-category`, `admin-toggle-category`, `admin-reorder-categories`, `admin-delete-category`, `admin-save-canned`, `admin-delete-canned`, `admin-save-kb`, `admin-delete-kb`

### Rules enforced on the server
- **Employees** see only their own tickets, plus tickets waiting for their approval. IT sees all tickets. **Internal notes are removed** before anything is sent to a non-IT user.
- Only IT can change status, assignee or priority. Only the IT manager or admin can declare a major incident.
- Only the approver, the IT manager or an admin can approve or reject, and never their own request.
- Tickets can be assigned only to active IT staff.
- An admin can't remove their own admin role or turn themselves off.
- Every input is validated and length-limited. Attachment links must be `http(s)`.

### Data model
`departments`, `users`, `sessions`, `settings`, `categories`, `canned_replies`, `kb_articles`, `tickets`, `ticket_messages`, `ticket_events`, `email_log`. Ticket numbers come from the `ticket_seq` sequence: `IT-1001`, `IT-1002`, …

Bilingual texts are stored as JSON: `{"en": "…", "ar": "…"}`.

### Environment variables
See `.env.example`. **Never commit real values.**

| Group | Variables |
|---|---|
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Sign-in | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNTS_URL` |
| Site | `APP_URL` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME` |
| Help desk rules | `IT_SUPPORT_EMAIL`, `BOOTSTRAP_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS` |

### Tests
```bash
npm install
PGHOST=/var/run/postgresql PGUSER=postgres npm test        # needs a local PostgreSQL 14+
PGHOST=/var/run/postgresql PGUSER=postgres node tests/run.js --serve   # then open http://localhost:4321/api/auth-login?as=hany@dar.test
```
The tests create a throwaway database and run `schema.sql` twice, to prove it is safe to re-run. They then run the real API code with Zoho sign-in faked and emails captured. The checks cover:
- sign-in rules
- permissions and visibility
- internal notes never reaching employees
- the support mailbox receiving exactly one email per ticket
- approvals, resolve/confirm/reopen
- admin validation
- signing out turned-off users

The `?as=` sign-in shortcut exists **only** inside the test server, never in the deployed app.
