# Going Live: Step-by-Step

The IT Help Desk needs its **own** accounts, separate from Taskflow, so the two systems never touch. Allow about 45 minutes.

## What you'll create
| Thing | Where | Why it must be new |
|---|---|---|
| A Supabase project | supabase.com → New project | Its own database, so IT data and Taskflow data never mix |
| A Vercel project | vercel.com → Add New → Project → import this repo | Its own website address and settings |
| A Zoho API client | api-console.zoho.com → Add Client → *Server-based Applications* | Its own sign-in, so neither system can break the other's login |
| A sending mailbox | e.g. `it-helpdesk@your-company.com` in Zoho Mail | Emails come from IT, not from a person's inbox |

## Steps
1. **Supabase:** create the project. In **SQL Editor**, paste and run **`schema.sql`**. Then copy the **Project URL** and the **service_role key** (Settings → API).
2. **Zoho API client:** create a *Server-based Application*.
   - Homepage URL: your Vercel address, e.g. `https://it-helpdesk.vercel.app`
   - Authorized redirect URI: `https://it-helpdesk.vercel.app/api/auth-callback`
   - Copy the **Client ID** and **Client Secret**.
3. **Mailbox:** create the sending mailbox. In Zoho Mail, make an **app password** for it (Settings → Security → App Passwords).
4. **Vercel:** import this repository. Then, in **Settings → Environment Variables**, add every variable in `.env.example` with your real values:
   - `IT_SUPPORT_EMAIL` = the mailbox that must receive **every** new ticket
   - `BOOTSTRAP_ADMIN_EMAILS` = your own email (you become the first admin)
   - `ALLOWED_EMAIL_DOMAINS` = your company email domain (e.g. `dar-elsalam.org`)
   - `APP_URL` = the Vercel address, with no `/` at the end
5. **Deploy.** Open the site and sign in with Zoho. You'll be the admin.
6. **Admin Console → Departments:** check the five starter departments, rename them or add more.
7. **Admin Console → Users & roles:** add the IT team (or let them sign in first). Set the **IT Manager** and **IT Agents**, and for each employee their **department** and **manager**. The manager is who approves their requests.
8. **Admin Console → Categories & forms:** set **"Auto-assign to"** for each category.
9. **Admin Console → General:** choose who approves requests and the fallback approver.
10. **Test:** raise a ticket as an employee. Check that the support mailbox received it, then resolve it as IT.

## Notes
- Everyone signs in again after 12 hours.
- To stop someone using the system, turn them off in **Users & roles**. They are signed out immediately.
- To check whether an email went out, look at the `email_log` table in Supabase. `ok = false` means sending failed; check the `SMTP_*` settings.
