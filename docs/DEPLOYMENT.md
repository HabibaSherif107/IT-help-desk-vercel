# Deployment Guide: Supabase, Zoho, Vercel and Your Domain

This puts the IT Help Desk online at its own address, for example **`https://helpdesk.your-company.com`**. It creates **new** accounts and settings only; nothing in Taskflow is touched.

**Time:** about 1–1½ hours, plus up to a few hours for the domain to start working.

---

## Before you start: checklist
| You need | Why |
|---|---|
| Admin access to **Supabase** | To create the database |
| Admin access to **Vercel**, signed in with GitHub | To publish the website |
| Access to the GitHub repo **HabibaSherif107/IT-help-desk-vercel** | Vercel reads the code from it |
| Admin access to **Zoho Mail Admin** (mailadmin.zoho.com) | To set up the mailbox the help desk sends from |
| Admin access to the **Zoho API Console** (api-console.zoho.com) | For the "Sign in with Zoho" button |
| Access to your domain's **DNS** settings | To connect `helpdesk.your-company.com` |
| The list of IT staff: who is the **IT Manager**, who are the **technicians**, and which categories each handles | For the set-up inside the app |

Keep a **private note** open and paste each value into it as you go. Never put these values in GitHub, chat or email:

| Value | Step |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | 1 |
| `SMTP_USER`, `SMTP_PASS` | 2b |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | 3 |

---

## Step 0: Choose the address
1. Choose a sub-address of your company domain, e.g. **`helpdesk.your-company.com`**. In the steps below, replace it with your choice.
2. Until the domain is connected (Step 5), the site also runs at Vercel's free address, e.g. **`https://it-help-desk-vercel.vercel.app`**. You'll set up both, so you can test early.

---

## Step 1: Supabase (the database)
1. Go to **supabase.com** → sign in → **New project**.
   - **Organization:** your company's.
   - **Project name:** `it-helpdesk`
   - **Database password:** click **Generate a password**, then copy it to your private note. The app doesn't use it, but you'll need it for backups and support.
   - **Region:** **Central EU (Frankfurt)**, the closest to Egypt.
   - **Plan:** *Free* works to start, but the Free plan pauses a project after 7 days without visits and has no automatic backups. **Pro** is recommended for a business tool.
   - Click **Create new project** and wait about 2 minutes.
2. Left menu → **SQL Editor** → **New query**.
3. Open **`schema.sql`** from the GitHub repo (click the file → **Raw** → select all → copy). Paste it into the editor and click **Run**. You should see *Success. No rows returned*.
4. Check: left menu → **Table Editor**. You should see **12 tables**:
   - `departments`, `users`, `sessions`, `settings`, `categories`, `canned_replies`, `kb_articles`, `tickets`, `ticket_messages`, `ticket_events`, `email_log`, `assets`, `stock_items`, `stock_movements`, `purchase_requests`, `purchase_request_lines`

   `departments` should contain 5 rows (IT, Finance, HR, Sales, Operations).
5. Left menu → **Project Settings** → **API Keys** (on some dashboards: **API**). Copy:
   - **Project URL** (e.g. `https://abcdxyz.supabase.co`, no `/` at the end) → `SUPABASE_URL`
   - The **service_role** key (on the *Legacy API keys* tab) or the **Secret key** (`sb_secret_…`) → `SUPABASE_SERVICE_KEY`

   ⚠ This key has full access to the database. Only ever paste it into Vercel.

> **Already ran `schema.sql` before?** Run the **latest** `schema.sql` again. It's safe to re-run: it adds anything new (for example the escalation fields, assets, laptop specs, device location and received date, the device allocation history, each person's company sector, the employee priority on devices, editable priority levels and statuses, and the stock and purchase-request tables) and keeps all existing data.

You don't need to set up anything under Authentication or Storage.

---

## Step 2: Zoho Mail

### 2a. Support group: optional, not needed
The help desk works **without** a shared support inbox. Every ticket is emailed to the person assigned to it. New tickets that nobody is assigned to, and replies on them, go to the **escalation contact** (the IT Manager, Step 7.5).
- **Recommended:** don't create one, and **leave `IT_SUPPORT_EMAIL` empty** in Vercel (Step 4). Nothing is ever sent to a "support" address; there is no hidden fallback.
- If you later want a shared inbox that gets copies of new tickets: create a Zoho group (e.g. `support@your-company.com`, *Who can email: Organization members*), put its address in `IT_SUPPORT_EMAIL` and redeploy. Per-category switches then appear in the Admin Console.

### 2b. The sending mailbox: required, sends all emails
The system must **sign in** to Zoho to send email, so it needs an address that has its **own login and app password**. That decides which kinds of Zoho mailbox work:

| Zoho mailbox type | Can the system sign in with it (`SMTP_USER`)? | Can emails *show* this address as the sender? |
|---|---|---|
| **Regular user mailbox** (licensed user) | ✅ Yes | ✅ Yes |
| **Shared mailbox / group** (e.g. `helpdesk@`) | ❌ No: it has no password of its own | ✅ Yes, via **Send as** (Option B) |

**Option A: dedicated user mailbox (simplest, recommended)**
1. **mailadmin.zoho.com** → **Users** → **Add user** → `it-helpdesk@your-company.com`, display name `IT Help Desk`. This uses one mail licence.
2. Allow SMTP for this user: **Users → it-helpdesk → Mail access** (or **Mail Policy → Access control**) → **SMTP: enabled**.
3. Sign in **as that user** at **accounts.zoho.com** → **Security** → **App Passwords** → **Generate New Password** → name it `IT Help Desk` → copy it → `SMTP_PASS`. The address is `SMTP_USER`.
   (If *App Passwords* isn't visible, first turn on **Multi-factor authentication** for this user.)

**Option B: emails appear to come from a shared mailbox (no extra licence)**
1. Keep, or create, the shared mailbox/group address you want people to see, e.g. `helpdesk@your-company.com`.
2. Choose an existing **licensed user** to do the actual sending, e.g. one IT account. Make them a member of that group and give them **Send as** permission for it (**mailadmin.zoho.com → Groups → the group → Settings / Permissions → Send as**).
3. Signed in as that user: **Zoho Mail → Settings → Mail → Send Mail As** → add `helpdesk@your-company.com` and confirm it.
4. Create an **app password** for that user (as in Option A, step 3).
5. In Vercel: `SMTP_USER` = that user's own address, `SMTP_PASS` = their app password, and **`MAIL_FROM_ADDRESS` = `helpdesk@your-company.com`**.

   ⚠ The help desk's emails then depend on that person's account. If they leave or their password is reset, update `SMTP_USER`/`SMTP_PASS` in Vercel and redeploy. If Zoho refuses with *"Sender is not allowed"*, the Send-as permission (step 2 or 3) isn't in place yet.

**SMTP server (both options):**
- `SMTP_HOST=smtppro.zoho.com`, `SMTP_PORT=465` (company-domain accounts)
- If emails fail, try `smtp.zoho.com`; EU data centre: `smtppro.zoho.eu`

**Replies:** if someone presses **Reply** on a help desk email, it goes to the sender address (the dedicated mailbox, or the shared mailbox in Option B). Ask staff to reply inside the help desk, or have someone glance at that mailbox now and then.

### 2c. Everyone who gets emails needs a real mailbox
Assignment, escalation and approval emails go to **each person's own address** as entered in the help desk (*Users & roles*, Step 7). Check that every technician, the IT Manager and every approving manager has a working Zoho mailbox at exactly that address.

### 2d. Deliverability (one-time check)
**mailadmin.zoho.com → Domains → your domain → Email configuration**: **SPF** and **DKIM** should both show as **verified**. If you already send company email through Zoho, they usually are. This keeps help desk emails out of spam.

---

## Step 3: Zoho API Console (the "Sign in with Zoho" button)
1. Go to **api-console.zoho.com** → sign in with an admin account → **Add Client** → **Server-based Applications** → **Create Now**.
2. Fill in:
   - **Client Name:** `IT Help Desk`
   - **Homepage URL:** `https://helpdesk.your-company.com`
   - **Authorized Redirect URIs:** add **both**, one per line or using **+**:
     - `https://helpdesk.your-company.com/api/auth-callback`
     - `https://it-help-desk-vercel.vercel.app/api/auth-callback`
3. Click **Create**. On the **Client Secret** tab, copy the **Client ID** → `ZOHO_CLIENT_ID` and the **Client Secret** → `ZOHO_CLIENT_SECRET`.
4. Check your Zoho region in the browser address bar. `accounts.zoho.com` → `ZOHO_ACCOUNTS_URL=https://accounts.zoho.com`; if it shows `.eu`, `.in` or `.com.au`, use that address instead.

This client belongs to the help desk only. Taskflow keeps its own client.

---

## Step 4: Vercel (the website)
1. Go to **vercel.com** → **Add New…** → **Project**.
2. Under **Import Git Repository**, find **IT-help-desk-vercel** → **Import**.
   If it isn't listed: **Adjust GitHub App Permissions** → *Only select repositories* → add **IT-help-desk-vercel** → Save → back to Vercel.
3. On the **Configure Project** screen:
   - **Project Name:** `it-help-desk-vercel`. This gives the address `it-help-desk-vercel.vercel.app`; if Vercel shows a different one, use that everywhere instead, including in Step 3.
   - **Framework Preset:** **Other**
   - **Root Directory:** `./` (unchanged). **Build and Output Settings:** leave empty and unchanged.
4. Open **Environment Variables** and add these variables one by one (*Key* → *Value* → **Add**):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | Step 1 |
   | `SUPABASE_SERVICE_KEY` | Step 1 |
   | `ZOHO_CLIENT_ID` | Step 3 |
   | `ZOHO_CLIENT_SECRET` | Step 3 |
   | `ZOHO_ACCOUNTS_URL` | `https://accounts.zoho.com` (or your region) |
   | `APP_URL` | `https://it-help-desk-vercel.vercel.app` (changed in Step 6) |
   | `SMTP_HOST` | `smtppro.zoho.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | the mailbox the system signs in with (Step 2b) |
   | `SMTP_PASS` | Step 2b |
   | `MAIL_FROM_NAME` | `IT Help Desk` |
   | `MAIL_FROM_ADDRESS` | **only for Option B** (Step 2b): the shared address to send as; otherwise don't add it |
   | `IT_SUPPORT_EMAIL` | **don't add it** (or leave it empty): no support mailbox. Only set it if you want a shared inbox (Step 2a). |
   | `BOOTSTRAP_ADMIN_EMAILS` | your own work email; you become the first admin |
   | `ALLOWED_EMAIL_DOMAINS` | `your-company.com` (anyone with this email domain can sign in as an employee) |

   No spaces before or after values, and no `/` at the end of addresses.
5. Click **Deploy** and wait for **Congratulations!** (about 1 minute).
6. **Quick test:** open `https://it-help-desk-vercel.vercel.app` → **Sign in with Zoho** → **Accept** → you should land on the **Admin Console**.
   - Instead you see *"The IT Help Desk isn't set up yet"*: Step 1 isn't finished, or the Supabase values are wrong.

> **Plan note:** Vercel's free *Hobby* plan is for personal, non-commercial use. A company tool is expected to be on **Pro**.

---

## Step 5: Your domain (DNS)
1. Vercel → your project → **Settings** → **Domains** → type `helpdesk.your-company.com` → **Add**.
2. Vercel shows a record to create, normally a **CNAME**. Copy the **Value** exactly as shown, e.g. `cname.vercel-dns.com` or a longer project-specific value.
3. Sign in where your domain's DNS is managed (Zoho Domains, GoDaddy, Namecheap, Cloudflare, your hosting company…) → **DNS / Zone editor** → **Add record**:

   | Field | Enter |
   |---|---|
   | Type | `CNAME` |
   | Name / Host | `helpdesk` (only the part before your domain) |
   | Value / Points to | the value from Vercel |
   | TTL | default (or 1 hour) |
   | Cloudflare only | Proxy status **DNS only** (grey cloud) |

4. **Don't change or delete any MX, SPF (TXT) or DKIM records.** Those carry your company email.
5. Back in Vercel → **Domains**, wait until it shows **Valid Configuration** (minutes, sometimes a few hours). Vercel then adds the HTTPS certificate automatically.

---

## Step 6: Switch to the final address
1. Vercel → **Settings** → **Environment Variables** → `APP_URL` → **Edit** → `https://helpdesk.your-company.com` (no `/` at the end) → **Save**.
2. Vercel → **Deployments** → the top (latest) deployment → **⋯** → **Redeploy** → **Redeploy**. Variable changes only take effect after a redeploy.
3. Open **`https://helpdesk.your-company.com`** and sign in. From now on, always use this address. Emails link to it too.
4. (Optional) In the Zoho API Console, remove the `vercel.app` redirect URI.

---

## Step 7: Set-up inside the app (as admin)
Do these in order. Each Admin Console page has its own **Save** button.

1. **Departments** (Admin Console → *Departments*): check the five starter departments, rename them (English and Arabic) or **+ Add department**.
2. **IT team** (Admin Console → *Users & roles*):
   - Ask the IT team to sign in once, or click **+ Add person** and enter their name and **exact work email**.
   - Set the **IT Manager** to role *IT Manager*.
   - Set each technician to role *IT Agent*, department *IT*.
3. **Employees** (same page): people are added automatically when they first sign in. For each one, **Edit** →
   - **Department**
   - **Manager**: this person approves their software and joiner/leaver requests
4. **Categories** (Admin Console → *Categories & forms* → **Edit** on each):
   - **Auto-assign to:** the technician who handles it, or **the IT Manager** for categories the manager handles personally. That person gets an email for every new ticket in the category.
   - **Needs manager approval:** on for New Software / License Purchase and New Joiner / Leaver (default).
   - Give **every** category an owner, including **Something Else** (usually the IT Manager), so no ticket waits unseen. Unowned tickets still email the escalation contact, but an owner is clearer.
   - (Only if you set up a support inbox: **Email the support mailbox…** switches per category.)
   - Adjust the extra questions if you like. **Save.**
5. **General** (Admin Console → *General*), then **Save changes**:
   - **Auto-assign new tickets by category:** on
   - **Who approves requests:** *the employee's manager* (recommended), plus a **fallback approver** for people with no manager
   - **Escalations go to:** the IT Manager. This is the default person when a technician presses **⬆ Escalate to manager / admin** (they can pick another IT manager or admin).
   - **Suggest articles:** on (recommended)
   - **When an employee says a resolved ticket is still not fixed, escalate to:** who receives those tickets (leave on *Same as IT escalations* to use the person above)
6. **Texts** (same page): adjust the Help Center greeting in both languages if you like.
7. **Canned replies** and **Knowledge base:** add your own ready-made replies and how-to articles.
8. **Assets** (left menu → *Assets* → **+ Add device**): enter company devices (type, model, serial, who has it, their location, the date they received it, and tick **Under warranty** to add the end date). For laptops, also fill in the **Laptop specs** box. Employees can then pick their device when raising a ticket.
9. **Stock** (left menu → *Stock* → **+ Add item**): type in what's on the current IT Stock sheet, with the quantity on hand and the minimum level. After that, change quantities only with **Adjust quantity**, so every change is logged.

---

## Step 8: Go-live test (about 20 minutes)
Use one employee account, one technician account and the IT Manager.

| # | Do this | Expect |
|---|---|---|
| 1 | Employee raises a ticket in a **technician's category** | It appears in the technician's **Ticket Queue → My tickets**. The **technician** gets *"[IT-…] A ticket was assigned to you"*, saying *"Assigned automatically (category: …)"*. The employee gets *"We received your request"*. |
| 2 | Employee raises a ticket in a category with **no owner** | The **IT Manager** (escalation contact) gets *"New ticket waiting to be assigned"*. It's in **Ticket Queue → Unassigned**. |
| 3 | Employee raises a ticket in a **category owned by the IT Manager** | The **IT Manager** gets the assignment email; the technician does not |
| 4 | Technician opens the ticket from test 1 → **⬆ Escalate to manager** → writes a reason → **Escalate** | The ticket moves to the IT Manager (**Escalated** tab). The **manager** gets *"Ticket escalated to you"* with the reason. The employee gets **no** email. |
| 5 | Manager hands it back (Assignee → technician) | The technician gets an assignment email again |
| 6 | Technician replies, then **Resolve** with a fix note | The employee is emailed each time, then closes the ticket (or presses **⬆ Not fixed – escalate**) |
| 7 | Employee raises a **New Software** request | Their manager gets an approval email and approves it in **Approvals**. The category's technician then gets *"assigned to you… Approved by …"*. |
| 8 | Open any ticket as IT → **History** | Shows created, assigned (and how), escalated, resolved… with names and times |
| 9 | Supabase → **Table Editor** → `email_log` | One row per email sent, each with `ok = true` |
| 10 | Open the site on a phone, switch to Arabic (🌐) | The page fits the screen and reads right-to-left |
| 11 | IT: **Assets → + Add device**, assign it to the test employee. Employee: raise a ticket and choose that device under **Related device**. | The device appears on the ticket and in the assignment email. Clicking the device on the Assets page lists the ticket. |
| 12 | IT agent: **Stock → + Add item** (quantity 2, minimum 2) → open it → **Request more** → add a price → **Save & submit for approval** | The item shows *Low Stock*. The IT manager gets a purchase-request email with the total. |
| 13 | IT manager: **Purchase Requests** → open it → **Approve**, then **Mark as received** | The agent is emailed the approval. The stock quantity goes up, and the item's history says *Received from PR-…*. |

When everything matches, share **`https://helpdesk.your-company.com`** with staff.

---

## Troubleshooting
| What you see | Likely cause → fix |
|---|---|
| *"The IT Help Desk isn't set up yet"* | `schema.sql` not run, or the Supabase values belong to another project → Step 1, check the Vercel variables, **Redeploy** |
| Zoho shows *Invalid Redirect Uri* | Redirect URI in Step 3 ≠ `APP_URL` + `/api/auth-callback` exactly |
| *"Your email isn't registered"* | Their email domain isn't in `ALLOWED_EMAIL_DOMAINS` → add it (then Redeploy), or add the person in **Users & roles** |
| *"Something went wrong while signing in"* | Wrong Client Secret or Zoho region → check the `ZOHO_*` variables; **Vercel → Logs** |
| *"The sign-in link expired"* | Sign-in was started on a different address than `APP_URL` → always use the final address |
| Nobody gets emails / `email_log.ok = false` | Wrong app password, SMTP not enabled for the mailbox, or wrong `SMTP_HOST` → Step 2b; look for *Email failed* in **Vercel → Logs** |
| A technician gets no assignment emails | Their address in **Users & roles** doesn't match their real mailbox (2c), or they aren't the category's **Auto-assign to** person |
| The IT Manager gets every ticket | `IT_SUPPORT_EMAIL` points to a group the manager is in → leave it empty (Step 2a), Redeploy |
| Zoho refuses: *Sender is not allowed* / *Relaying disallowed* | `MAIL_FROM_ADDRESS` is set but the `SMTP_USER` account has no **Send as** permission for it → Step 2b Option B, or remove `MAIL_FROM_ADDRESS` |
| The Escalate button is missing | There is no other active IT manager / admin to escalate to, or the ticket is waiting for approval or already resolved |
| Emails land in spam | SPF/DKIM not verified → Step 2d |
| Domain stuck on *Invalid Configuration* | CNAME typo, or Cloudflare proxy on → fix the record; allow time to spread |

---

## Looking after it
- **Updates:** every change pushed to the `main` branch on GitHub deploys automatically. If an update changes `schema.sql`, run the new version once in Supabase (it's safe to re-run).
- **Backups:** Supabase Pro takes daily backups. On Free, export regularly (Supabase → **Database → Backups**, or `pg_dump` with the database password).
- **Changing passwords or keys:** update the value in Vercel → **Redeploy**.
- **Someone leaves:** **Users & roles** → Edit → turn **Active** off. They're signed out immediately. Reassign their open tickets from the **Ticket Queue**.
- **A technician changes responsibilities:** update **Auto-assign to** in *Categories & forms*.
