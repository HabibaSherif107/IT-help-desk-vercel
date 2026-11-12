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
| 👤 **Employee** | Help Center, My Requests, Knowledge Base | Search quick fixes, raise tickets, chat with IT, close a resolved ticket, or escalate it if it's still not fixed |
| 🛠️ **IT Agent** | Ticket Queue, Assets, Stock, Purchase Requests, My Requests, Knowledge Base | Take tickets, reply, write private notes, change status/priority, resolve, **escalate to the IT manager**, add and update devices, update stock, raise purchase requests |
| 👑 **IT Manager** | Everything an agent sees, plus Dashboard, Approvals, Auto-assignment | Approve or reject requests and purchase requests, declare a major incident, delete stock items |
| 🛡️ **Admin** | Admin Console, plus everything above | Everything an IT manager can do (approvals, escalations, purchase approvals, auto-assignment), plus manage people, departments, categories, questions, priorities, statuses, replies, articles, dropdown lists and settings |
| *Any manager* | Approvals (when someone they manage asks for something) | Approve or reject that person's requests |

### Assets (device inventory)
IT keeps a list of company devices: type (Laptop, Desktop, PC, Monitor, Printer / Scanner, Mobile phone, Network device, Accessory, Other), make/model, serial number, who has it, status (*In use, In stock, Needs repair, Retired*), purchase date and warranty. Tick **Under warranty** to enter the warranty end date. Devices are numbered automatically, so there's no tag to type in.
- The **Assets** page shows totals, devices in repair, and warranties ending within 90 days or already expired. You can search and filter it.
- **Filter by department and company sector:** the list can be filtered by the department and/or the company sector (Shell, Chipsy, Jammy) of the person holding the device, or by *No department* / *No sector*. Each holder's department and sector are shown under their name.
- **Employee priority** (High / Medium / Low by default, editable) appears once the device is assigned to someone, also in *Allocate to…*. It is cleared when the device returns to IT, and the list can be filtered by it.
- **Location** is picked from a list (editable in the Admin Console): *Abis, Khorshid, Kafr El Sheikh, Beheira / Damanhour*. The list can be filtered by location.
- **Received by holder on** sits next to the purchase date. Like every date, it stays empty unless you enter it. It can't be before the purchase date and is cleared when the device comes back to IT.
- **⇄ Allocate to…** (on a device's page) moves the device to another person or back to IT stock, with an optional received date, location and note. If the new person already has a device, you can **swap**: their device goes to the previous holder in the same step. Every move is kept in the device's **Allocation history** (from → to, date, who did it).
- **Laptops and PCs have a Specs section:** processor, RAM, storage, Windows 11 compatibility (Compatible / Not compatible / Not checked yet), expected lifetime and a recommendation chosen from a fixed list (*Keep and upgrade SSD/RAM if needed*, *Replace within 1 year*, *Retire immediately*). It only appears when the type is *Laptop* or *PC*. The main specs and a Win 11 ✓/✕ show under the device in the list, and you can search by them.
- Clicking a device shows its details and **every ticket about it**.
- When raising a ticket, employees can pick **their own device**. IT can link or change the device on any ticket, and the device appears in the ticket emails.
- IT agents and managers can add and edit devices. Only the IT manager or an admin can delete one, and a device with tickets can only be *Retired*, so its history is kept.

### Stock (replaces the "IT Stock" sheet)
Same columns as the sheet: **Category · Item name · Brand / Model · Quantity in stock · Minimum level · Status · Notes**, with the same categories (Hardware, Handhelds, Laptops, Cables & Adapters, Networking, Accessories, Spare Parts, Others).
- **Status works like the sheet's formula.** Quantity 0 shows *Out of Stock*. At or below the minimum level it shows *Low Stock*. Otherwise it shows *In Stock*. The top of the page counts items, units, low stock and out of stock.
- **Quantities only change through "Adjust quantity"** (add or take out, plus a reason such as "Given to Sara"). Every change is saved in the item's **Quantity history** with who made it and when.
- **Request more** opens a new purchase request with that item already filled in.
- **🧾 Restock low items** (top of the Stock page) opens one purchase request with every *Low* / *Out of Stock* item already filled in: name and model, a suggested quantity (back to twice the minimum level), and the link to the stock item so receiving it adds to stock. Add prices and submit as usual.
- Each stock item can have an optional **serial number**; it stays empty unless you fill it in.

### Purchase Requests (replaces the "IT Purchase Request" sheet)
Same layout as the sheet: **# · Item name · Product link · Quantity · Unit price (EGP) · Total price (EGP)**, with the **Grand total** worked out automatically. Each request gets its own running number that is never reused: `PR-001` … `PR-999`, then `PR-1000`, `PR-1001` …. Requests made with earlier formats are converted once when `schema.sql` is run (`PR-00001` → `PR-001`; month-based ones such as `PR-1126` get the next running numbers).
- The paper signatures are now steps in the app: **Draft → Submit for approval → Approved / Rejected → Ordered → Received.** The *Submitted by* and *Approved by* boxes fill in automatically with names and dates.
- When a request is submitted, the IT managers and admins get a bilingual email listing the items and the total. The person who submitted it is emailed the decision; a rejection includes the reason. A manager can't approve their own request.
- A rejected request can be fixed and submitted again. Drafts and rejected requests can be deleted.
- Each line can be linked to a stock item. When the request is marked **Received**, those quantities are added to stock automatically, and the stock history notes which request they came from.
- **Print** gives a printable page with the same look as the sheet, including signature lines.

### Priorities, questions and statuses (Admin Console)
- **Priority & questions:** add (up to 8), remove, rename, recolour and reorder priority levels. The top level is the most urgent: the top two count as *Urgent* in the queue and dashboard, and a major incident takes the top level. Add or remove answers to *Who is affected?* and *How urgent is it?* (2–5 each). The priority matrix grows or shrinks to match, and new cells start at the least urgent level. A priority level that tickets use can't be deleted.
- **Statuses:** the 8 built-in statuses (🔒) drive the ticket workflow, so they can be renamed and recoloured but not deleted. You can add up to 10 of your own (for example *On hold – waiting for parts*). They count as open, and IT can set them on a ticket. A status that tickets are in can't be deleted.

### "View as" (admins only)
At the bottom of the left menu, admins have a **👁 View as** switch: *Admin (me)*, *Employee*, *IT Agent* or *IT Manager*. While previewing, the whole help desk (menus, pages, what you can see and do) behaves exactly as it would for that role. The server enforces it, not just the screen. A yellow banner shows you're in preview, with **Back to Admin**.
- You act as yourself: anything you do (raise a ticket, approve, adjust stock) is real and recorded under your name.
- The preview lasts for that browser tab until you switch back or close the tab.
- Only real admins can use it, and it can only lower access, never raise it.

### Dropdown lists (Admin Console → Dropdown lists)
Admins can add, rename, reorder and delete the options of these dropdowns, in English and Arabic: **Device types, Locations, Company sectors, Employee priority, Stock categories**. Press **Save changes** when done.
- Renaming updates everywhere at once (devices and people keep pointing at the same option).
- An option that is still in use can't be deleted. The message says how many items use it; change those first.
- A list can't be emptied, and the same name can't appear twice.
- Departments, ticket categories, priorities and statuses have their own tabs. Device status (In use / In stock / Needs repair / Retired), Windows 11 compatibility and the specs Recommendation stay fixed, because the app relies on them.

### People: department and company sector
In **Admin Console → Users & roles** you can search people and filter **Signed in** / **Not signed in yet** (with the last sign-in time). Each person has a **Department** and, next to it, a **Company sector** chosen from a fixed list: *Shell, Chipsy, Jammy*. The sector also shows as a column in the people table.

### Help categories
Request Hardware · Internet & Connectivity · Email & Accounts · New Software / License Purchase *(needs approval)* · New Joiner / Leaver *(needs approval)* · Something Else.
Admins can rename, reorder, hide, add or remove categories and change their questions.

### How a ticket moves
1. The employee searches first. Matching how-to articles appear and may solve it right away.
2. The employee picks a category and answers its short questions, plus *"Who is affected?"* and *"How urgent is it?"*. These set the priority (P1–P4).
3. The ticket goes automatically to the person who owns that category. That can be a technician (e.g. Hardware → Karim) or the IT manager (e.g. Email & Accounts → the manager). Only that person is emailed.
4. Software and joiner/leaver requests first wait for the **employee's manager** to approve.
5. IT replies (or writes private notes), then marks the ticket resolved with a note on the fix.
6. The employee closes it. If it's still not fixed, they press **⬆ Not fixed – escalate** and say what's wrong: the ticket reopens and goes to the person the admin chose under **General → "When an employee says a resolved ticket is still not fixed, escalate to"** (by default the normal escalation contact). That person is emailed the message, and the previous technician is told.

**Escalation:** if a technician can't finish a ticket, they press **⬆ Escalate to manager / admin**, choose which IT manager or admin (the default is the one set under *General → Escalations go to*) and write why. The ticket moves to that person, who gets an email with the reason. The reason stays private to IT, and the employee isn't notified. The manager can solve it or hand it back. Admins choose who receives escalations (**Admin Console → General**).

### Emails
| When | Who gets an email |
|---|---|
| **Any new ticket** | The employee (confirmation) and the category's owner, or the approver. If **nobody is assigned**, the IT manager (escalation contact). An optional shared support inbox (`IT_SUPPORT_EMAIL`) can also get copies; by default there is none. |
| **Assigned**: automatically by category, by a colleague, taken by the technician, or after approval | **The assigned person, every time.** The email says how it was assigned. |
| Escalated | The IT manager receiving escalations, with the reason |
| IT replies | The employee |
| The employee replies | The assigned IT person (or the IT manager if nobody is assigned) |
| Assigned / approved / rejected / resolved / escalated by the employee | The people involved |

Every email is in Arabic and English and is recorded in a log (`email_log`). IT staff also see a **History** on each ticket (created, assigned, status changes, escalations, approvals, resolution), so every step is documented both in the app and by email.

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
| `api/_session.js` | Sessions: random 64-hex token in the HttpOnly `ithd_session` cookie, 7 days from sign-in (everyone signs in once a week) |
| `api/_email.js` | SMTP sending via nodemailer, HTML-escaped bilingual template, writes `email_log` |
| `api/_db.js` | Supabase client using the service key, server-side only |
| `schema.sql` | All tables. RLS is on with no policies, so only the server (service key) can read or write. |
| `tests/run.js` | End-to-end tests (see below) |

Files starting with `_` are helpers, not endpoints. The app uses **4 serverless functions**.

### API actions
- **Read:** `bootstrap`, `list-tickets`, `kb-view`
- **Assets:** `list-assets`, `save-asset`, `delete-asset` (`update-ticket` also accepts `asset`)
- **Stock:** `list-stock`, `stock-history`, `save-stock-item`, `adjust-stock`, `delete-stock-item` (in `api/_stock.js`)
- **Purchase requests:** `list-prs`, `save-pr`, `submit-pr`, `decide-pr`, `order-pr`, `receive-pr`, `delete-pr` (in `api/_stock.js`)
- **Tickets:** `create-ticket`, `reply`, `update-ticket` (assignee / status / priority / major), `escalate`, `resolve`, `confirm`, `reopen`, `approve`, `reject`
- **Admin:** `admin-save-user`, `admin-save-dept`, `admin-delete-dept`, `admin-save-settings`, `admin-save-category`, `admin-toggle-category`, `admin-reorder-categories`, `admin-delete-category`, `admin-save-canned`, `admin-delete-canned`, `admin-save-kb`, `admin-delete-kb`

### Rules enforced on the server
- **Employees** see only their own tickets, plus tickets waiting for their approval. IT sees all tickets. **Internal notes are removed** before anything is sent to a non-IT user.
- Only IT can change status, assignee or priority. Only the IT manager or admin can declare a major incident.
- Only the approver, the IT manager or an admin can approve or reject, and never their own request.
- Tickets can be assigned only to active IT staff.
- An admin can't remove their own admin role or turn themselves off.
- Every input is validated and length-limited. Attachment links must be `http(s)`.

### Data model
`departments`, `users`, `sessions`, `settings`, `categories`, `canned_replies`, `kb_articles`, `tickets`, `ticket_messages`, `ticket_events`, `email_log`, `assets`, `stock_items`, `stock_movements`, `purchase_requests`, `purchase_request_lines`. Ticket numbers come from the `ticket_seq` sequence: `IT-1001`, `IT-1002`, …

Bilingual texts are stored as JSON: `{"en": "…", "ar": "…"}`.

### Environment variables
See `.env.example`. **Never commit real values.**

| Group | Variables |
|---|---|
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Sign-in | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNTS_URL` |
| Site | `APP_URL` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS` (optional "send as" address) |
| Help desk rules | `IT_SUPPORT_EMAIL` (optional; empty = no support inbox), `BOOTSTRAP_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS` |

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
- the optional support inbox receiving exactly one email per ticket, and nothing at all when it's removed
- approvals, resolve/confirm/reopen
- admin validation
- signing out turned-off users
- stock status rules and the quantity log
- the purchase-request flow (totals, numbering, approval emails, receiving into stock)

The `?as=` sign-in shortcut exists **only** inside the test server, never in the deployed app.
