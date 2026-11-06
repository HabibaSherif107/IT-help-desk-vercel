# Deployment Guide: Supabase, Zoho, Vercel and Your Domain

This puts the IT Help Desk online at its own address, for example **`https://helpdesk.your-company.com`**. It creates **new** accounts and settings only. Nothing in Taskflow is touched.

**Time:** about 1 hour, plus up to a few hours for the domain to start working.
**You'll need:** admin access to Supabase, Vercel, GitHub, the Zoho Mail admin console, and wherever your domain's DNS is managed.

Keep a private note open while you work and paste each value into it as you go. Never put these values in GitHub, chat or email:

| Value | You get it in |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Step 1 |
| `SMTP_USER`, `SMTP_PASS` | Step 2 |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | Step 3 |

---

## Step 0: Choose the address
Pick a sub-address of your company domain, for example `helpdesk.your-company.com`. In the steps below, replace it with your choice.

Until the domain is connected (Step 5), the site also runs at Vercel's free address, e.g. `https://it-help-desk-vercel.vercel.app`. You'll set up both, so you can test before the domain is ready.

---

## Step 1: Supabase (the database)
1. Go to **supabase.com** → sign in → **New project**.
   - **Organization:** your company's.
   - **Name:** `it-helpdesk`
   - **Database password:** click *Generate*, then save it in your private note. The app doesn't need it, but you'll need it for support or backups.
   - **Region:** the one closest to your users (for Egypt: **Central EU (Frankfurt)**).
   - **Plan:** Free to start. The Free plan allows 2 active projects and pauses a project after a week with no activity. For a business tool, Pro is recommended (daily backups, no pausing).
2. Wait about 2 minutes until the project is ready.
3. Open **SQL Editor** → **New query**. Paste the full contents of **`schema.sql`** from this repository and click **Run**. It should end with *Success. No rows returned*.
4. Check: **Table Editor** should list 11 tables, and `departments` should have 5 rows.
5. Open **Project Settings → API Keys** (or **API** on older dashboards) and copy:
   - **Project URL** → `SUPABASE_URL` (e.g. `https://abcdxyz.supabase.co`, no `/` at the end)
   - The **service_role** key (*Legacy API keys* tab) or the **Secret key** (`sb_secret_…`) → `SUPABASE_SERVICE_KEY`
   ⚠ This key has full access to the database. Only ever paste it into Vercel.

You don't need to set up anything under Authentication or Storage.

---

## Step 2: Zoho Mail (sending and receiving emails)

### 2a. Support mailbox: receives every new ticket
Every new ticket is emailed here (`IT_SUPPORT_EMAIL`).
1. Open **mailadmin.zoho.com** → **Groups** → **Create group**.
2. **Name:** IT Support. **Email:** `support@your-company.com`. **Members:** the IT team.
3. **Who can send to this group:** set it to **Everyone** (or *Organization members*, if your sending mailbox in 2b is on the same domain).

A group means every IT person receives the emails, and nobody's personal inbox is the only copy.

### 2b. Sending mailbox: sends the emails
1. In **mailadmin.zoho.com** → **Users** → **Add user**: `it-helpdesk@your-company.com` (this uses one mail licence).
2. Check that **IMAP/POP/SMTP access** is allowed for this user (**Users → it-helpdesk → Mail access**, or **Mail Policy → Access control**).
3. Sign in **as that user** at **accounts.zoho.com** → **Security** → **App Passwords** → **Generate new password**. Name it `IT Help Desk`.
   (If App Passwords isn't shown, turn on two-factor authentication for this user first.)
4. Copy the generated password → `SMTP_PASS`. The address is `SMTP_USER`.
5. SMTP server settings:
   - Company-domain (organisation) accounts: `SMTP_HOST=smtppro.zoho.com`, `SMTP_PORT=465`
   - If that fails, try `smtp.zoho.com` (the server Taskflow uses)
   - If your Zoho account is in the EU data centre, use `smtppro.zoho.eu` / `smtp.zoho.eu`

### 2c. Deliverability check (one-time)
In **mailadmin.zoho.com → Domains → your domain → Email configuration**, check that **SPF** and **DKIM** show as verified. If you already send company email through Zoho, they usually are. This keeps help desk emails out of spam.

---

## Step 3: Zoho API Console (the "Sign in with Zoho" button)
1. Go to **api-console.zoho.com** (sign in with an admin account) → **Add Client** → **Server-based Applications**.
2. Fill in:
   - **Client Name:** `IT Help Desk`
   - **Homepage URL:** `https://helpdesk.your-company.com`
   - **Authorized Redirect URIs:** add **both** of these:
     - `https://helpdesk.your-company.com/api/auth-callback`
     - `https://it-help-desk-vercel.vercel.app/api/auth-callback` (for testing before the domain works)
3. Click **Create**. Copy the **Client ID** → `ZOHO_CLIENT_ID` and the **Client Secret** → `ZOHO_CLIENT_SECRET`.
4. Note your Zoho region from the address bar. `accounts.zoho.com` means `ZOHO_ACCOUNTS_URL=https://accounts.zoho.com`; for `.eu` / `.in` / `.com.au`, use that address.

This client belongs to the help desk only. Taskflow keeps its own client, so neither can break the other's sign-in.

---

## Step 4: Vercel (the website)
1. Go to **vercel.com** → **Add New… → Project** → **Import Git Repository** → choose **`HabibaSherif107/IT-help-desk-vercel`**.
   If it isn't listed: **Adjust GitHub App Permissions** → allow this repository.
2. On the configure screen:
   - **Project Name:** `it-help-desk-vercel`. This gives the address `it-help-desk-vercel.vercel.app`; if Vercel shows a different address, use that one everywhere instead.
   - **Framework Preset:** **Other**. Leave the root directory as `./` and leave the build and output settings empty.
3. Open **Environment Variables** and add each of these (*Key* = left column, *Value* = your value):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | from Step 1 |
   | `SUPABASE_SERVICE_KEY` | from Step 1 |
   | `ZOHO_CLIENT_ID` | from Step 3 |
   | `ZOHO_CLIENT_SECRET` | from Step 3 |
   | `ZOHO_ACCOUNTS_URL` | `https://accounts.zoho.com` (or your region) |
   | `APP_URL` | `https://it-help-desk-vercel.vercel.app` for now; changed in Step 6 |
   | `SMTP_HOST` | `smtppro.zoho.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `it-helpdesk@your-company.com` |
   | `SMTP_PASS` | app password from Step 2b |
   | `MAIL_FROM_NAME` | `IT Help Desk` |
   | `IT_SUPPORT_EMAIL` | `support@your-company.com` |
   | `BOOTSTRAP_ADMIN_EMAILS` | your own work email (you become the first admin) |
   | `ALLOWED_EMAIL_DOMAINS` | `your-company.com` (anyone with this email domain can sign in as an employee) |

4. Click **Deploy** and wait for *Congratulations*.
5. **Quick test:** open `https://it-help-desk-vercel.vercel.app` → **Sign in with Zoho** → approve → you should see the **Admin Console**.

> **Plan note:** Vercel's free *Hobby* plan is meant for personal, non-commercial use. For a company tool, Vercel expects the **Pro** plan.

---

## Step 5: Your domain (DNS)
1. In Vercel: **Project → Settings → Domains → Add** → type `helpdesk.your-company.com` → **Add**.
2. Vercel shows a **CNAME** record to create. Copy the value **exactly** as shown, e.g. `cname.vercel-dns.com` or a longer project-specific value.
3. Sign in where your domain's DNS is managed (Zoho Domains, GoDaddy, Namecheap, Cloudflare, your hosting company…) → **DNS / Zone editor** → **Add record**:
   - **Type:** `CNAME`
   - **Name / Host:** `helpdesk` (only the part before your domain)
   - **Value / Points to:** the value from Vercel
   - **TTL:** default (or 1 hour)
   - On **Cloudflare**, set the proxy to **DNS only** (grey cloud).
4. Don't change or delete any **MX**, **SPF (TXT)** or **DKIM** records; those carry your company email.
5. Back in Vercel, wait until the domain shows **Valid Configuration**. Usually this takes minutes, sometimes a few hours. Vercel then adds the HTTPS certificate automatically.

---

## Step 6: Switch to the final address
1. **Vercel → Settings → Environment Variables:** edit `APP_URL` → `https://helpdesk.your-company.com` (no `/` at the end) → Save.
2. **Vercel → Deployments** → the latest one → **⋯ → Redeploy**. Variable changes only take effect after a redeploy.
3. Open `https://helpdesk.your-company.com` and sign in again. From now on, always use this address.
4. (Optional, later) In the Zoho API Console, remove the `vercel.app` redirect URI.

---

## Step 7: First-time set-up inside the app
Signed in as admin:
1. **Admin Console → Departments:** rename or add departments (English + Arabic).
2. **Admin Console → Users & roles:**
   - Add the IT team, or ask them to sign in once so they appear.
   - Set the **IT Manager** and **IT Agents**.
   - For each employee, set **Department** and **Manager**; the manager approves their requests.
3. **Admin Console → Categories & forms:** set **Auto-assign to** for each category.
4. **Admin Console → General:** choose who approves requests and the fallback approver; review the switches.
5. **Admin Console → Knowledge base / Canned replies:** add your own articles and replies.

---

## Step 8: Go-live test (15 minutes)
| Test | Expected result |
|---|---|
| An employee raises a ticket | It appears in **My Requests** |
| Support group inbox | Gets *[IT-1001] New IT ticket* within a minute |
| Employee's inbox | Gets *We received your request* |
| IT agent replies; then resolves | Employee is emailed each time; then confirms and rates |
| New Software request | The employee's manager gets an approval email and can approve it in **Approvals** |
| Supabase → Table Editor → `email_log` | One row per email; `ok = true` |
| Phone + Arabic | Page fits the screen; 🌐 switches to Arabic |

Then share the address with staff.

---

## Troubleshooting
| What you see | Likely cause → fix |
|---|---|
| *"The IT Help Desk isn't set up yet"* | `schema.sql` wasn't run, or the Supabase URL/key belong to another project → recheck Step 1 and the Vercel variables, then redeploy |
| Zoho says *Invalid Redirect Uri* | The redirect URI in Step 3 doesn't exactly match `APP_URL` + `/api/auth-callback` |
| *"Your email isn't registered"* | Their email domain isn't in `ALLOWED_EMAIL_DOMAINS` → add the domain, or add them in **Users & roles** |
| *"Something went wrong while signing in"* | Wrong Client Secret or Zoho region → check `ZOHO_*` variables; see **Vercel → Logs** |
| *"The sign-in link expired"* | Sign-in started on a different address than `APP_URL` → always use the final address |
| No emails / `email_log.ok = false` | Wrong app password, SMTP access off for the mailbox, or wrong `SMTP_HOST` → see Step 2b; see **Vercel → Logs** for *Email failed* |
| Emails land in spam | SPF/DKIM not verified → Step 2c |
| Domain stuck on *Invalid Configuration* | CNAME name/value typo, or Cloudflare proxy on → fix the record; allow time to spread |

## Looking after it
- **Backups:**
  - Supabase Pro takes daily backups automatically.
  - On Free, export regularly: Supabase → Database → Backups, or `pg_dump` with the database password.
- **Changing passwords and keys:** after replacing any key or password, update it in Vercel and **redeploy**.
- **Someone leaves:** turn them off in **Users & roles**. They're signed out immediately.
- **Updates:** changes pushed to the `main` branch on GitHub deploy automatically.
