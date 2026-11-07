// tests/run.js — end-to-end tests for the IT Help Desk API.
//
// Runs the real api/*.js code against a throwaway local PostgreSQL database
// (through a small adapter that mimics the supabase-js calls the app uses),
// fakes Zoho sign-in, and captures emails instead of sending them.
//
//   Needs: PostgreSQL 14+ you can create databases on, and `npm install`.
//   Run:   PGHOST=/var/run/postgresql PGUSER=postgres npm test
//          (standard PG* environment variables pick the server)
//   Add --serve to keep the app running on http://localhost:4321 afterwards
//   (sign in as anyone with: http://localhost:4321/api/auth-login?as=email).
const http = require("http"), fs = require("fs"), path = require("path"), Module = require("module"), { URL } = require("url");
const { Client, Pool, types } = require("pg");
types.setTypeParser(1082, v => v); // return DATE columns as "YYYY-MM-DD" text, like Supabase does
const ROOT = path.join(__dirname, "..");
const DB = "ithd_test_" + process.pid;
const SERVE = process.argv.includes("--serve");
const PORT = 4321;

process.env.APP_URL = `http://localhost:${PORT}`;
process.env.IT_SUPPORT_EMAIL = "support@company.com";
process.env.BOOTSTRAP_ADMIN_EMAILS = "hany@dar.test";
process.env.ALLOWED_EMAIL_DOMAINS = "dar.test";
process.env.ZOHO_ACCOUNTS_URL = "https://zoho.fake";

let pool;
const mails = [];

// ── supabase-js adapter (only what the app uses) ──────────────
const JSONB = { settings: ["value"], departments: ["name"], categories: ["name", "description", "fields"], canned_replies: ["title", "body"], kb_articles: ["title", "steps"], tickets: ["fields"] };
const val = (t, c, v) => ((JSONB[t] || []).includes(c) || (v !== null && typeof v === "object" && !(v instanceof Date))) ? JSON.stringify(v) : v;
class Q {
  constructor(t) { this.t = t; this.op = null; this.f = []; this.o = []; this.lim = null; this.one = null; }
  select(cols) { if (!this.op) { this.op = "select"; this.cols = cols || "*"; } return this; }
  insert(v) { this.op = "insert"; this.rows = [].concat(v); return this; }
  upsert(v, o) { this.op = "upsert"; this.rows = [].concat(v); this.conf = (o && o.onConflict) || "id"; return this; }
  update(v) { this.op = "update"; this.vals = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.f.push([c, "=", v]); return this; }
  neq(c, v) { this.f.push([c, "<>", v]); return this; }
  lt(c, v) { this.f.push([c, "<", v]); return this; }
  in(c, v) { this.f.push([c, "in", v]); return this; }
  order(c, o) { this.o.push(`"${c}" ${o && o.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  where(p) {
    if (!this.f.length) return "";
    return " where " + this.f.map(([c, op, v]) => {
      if (op === "in") { p.push(v); return `"${c}" = any($${p.length})`; }
      p.push(val(this.t, c, v)); return `"${c}" ${op} $${p.length}`;
    }).join(" and ");
  }
  async run() {
    const p = []; let sql;
    if (this.op === "select") {
      const cols = this.cols === "*" ? "*" : this.cols.split(",").map(s => `"${s.trim()}"`).join(", ");
      sql = `select ${cols} from ${this.t}` + this.where(p) + (this.o.length ? " order by " + this.o.join(", ") : "") + (this.lim ? " limit " + this.lim : "");
    } else if (this.op === "insert" || this.op === "upsert") {
      const cols = [...new Set(this.rows.flatMap(r => Object.keys(r)))];
      const vals = this.rows.map(r => "(" + cols.map(c => { p.push(c in r ? val(this.t, c, r[c]) : null); return `$${p.length}`; }).join(", ") + ")");
      sql = `insert into ${this.t} (${cols.map(c => `"${c}"`).join(", ")}) values ${vals.join(", ")}`;
      if (this.op === "upsert") sql += ` on conflict ("${this.conf}") do update set ` + cols.filter(c => c !== this.conf).map(c => `"${c}" = excluded."${c}"`).join(", ");
    } else if (this.op === "update") {
      const sets = Object.entries(this.vals).map(([c, v]) => { p.push(val(this.t, c, v)); return `"${c}" = $${p.length}`; });
      if (!sets.length) return { data: null, error: null };
      sql = `update ${this.t} set ${sets.join(", ")}` + this.where(p);
    } else sql = `delete from ${this.t}` + this.where(p);
    try {
      const r = await pool.query(sql, p);
      let data = this.op === "select" ? r.rows : null;
      if (this.one) {
        if (data.length > 1 || (this.one === "single" && !data.length)) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        data = data[0] || null;
      }
      return { data, error: null };
    } catch (e) { return { data: null, error: { message: e.message } }; }
  }
  then(a, b) { return this.run().then(a, b); }
}
const fakeSupabase = {
  from: t => new Q(t),
  rpc: async n => { try { return { data: (await pool.query(`select ${n}() as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
};
const origLoad = Module._load;
Module._load = function (req) {
  if (req === "@supabase/supabase-js") return { createClient: () => fakeSupabase };
  if (req === "nodemailer") return { createTransport: () => ({ sendMail: async m => { mails.push(m); return {}; } }) };
  return origLoad.apply(this, arguments);
};
// Fake Zoho: the authorization "code" is the email address that signs in.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith("https://zoho.fake/oauth/v2/token")) return { json: async () => ({ access_token: "tok:" + new URLSearchParams(opts.body.toString()).get("code") }) };
  if (String(url).startsWith("https://zoho.fake/oauth/user/info")) { const email = opts.headers.Authorization.split("tok:")[1]; return { json: async () => ({ Email: email, Display_Name: email.split("@")[0] }) }; }
  return realFetch(url, opts);
};

// ── Tiny Vercel-like server ───────────────────────────────────
const handlers = { app: require(ROOT + "/api/app.js"), "auth-login": require(ROOT + "/api/auth-login.js"), "auth-callback": require(ROOT + "/api/auth-callback.js"), "auth-logout": require(ROOT + "/api/auth-logout.js") };
function serve() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const name = u.pathname.startsWith("/api/") ? u.pathname.slice(5) : null;
    // Test-only shortcut (never in the real app): /api/auth-login?as=email starts a real sign-in for that email.
    if (name === "auth-login" && u.searchParams.get("as")) {
      res.writeHead(302, { "Set-Cookie": "ithd_oauth_state=s; Path=/", Location: `/api/auth-callback?code=${encodeURIComponent(u.searchParams.get("as"))}&state=s` }); return res.end();
    }
    if (handlers[name]) {
      let raw = ""; for await (const c of req) raw += c;
      req.query = Object.fromEntries(u.searchParams); req.body = raw ? JSON.parse(raw) : {};
      res.status = function (c) { this.statusCode = c; return this; };
      res.json = function (o) { this.setHeader("Content-Type", "application/json"); this.end(JSON.stringify(o)); };
      try { await handlers[name](req, res); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    if (u.pathname === "/__mails") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(mails.map(m => ({ to: m.to, subject: m.subject, text: m.text, html: m.html })))); }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fs.readFileSync(ROOT + "/index.html"));
  }).listen(PORT);
}

// ── Test helpers ──────────────────────────────────────────────
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); } };
const jar = {};
async function signIn(email, state = "s1", sendState = "s1") {
  const r = await realFetch(`${BASE}/api/auth-callback?code=${encodeURIComponent(email)}&state=${state}`, { headers: { Cookie: `ithd_oauth_state=${sendState}` }, redirect: "manual" });
  const m = /ithd_session=([^;]+)/.exec((r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")]).join(";"));
  if (m && m[1]) jar[email] = m[1];
  return r.headers.get("location");
}
async function call(email, action, data) {
  const r = await realFetch(BASE + "/api/app", { method: "POST", headers: { "Content-Type": "application/json", ...(email && jar[email] ? { Cookie: "ithd_session=" + jar[email] } : {}) }, body: JSON.stringify({ action, ...(data || {}) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const SUPPORT = "support@company.com";
const supportTicketMails = () => mails.filter(m => m.to === SUPPORT && /New IT ticket/.test(m.subject));

async function tests() {
  console.log("Sign-in");
  let loc = await signIn("hany@dar.test");
  ok(loc === BASE + "/" && jar["hany@dar.test"], "bootstrap admin can sign in");
  ok((await call("hany@dar.test", "bootstrap")).body.me.role === "admin", "…and is an admin");
  ok((await signIn("stranger@gmail.com")) === BASE + "/?error=not_registered", "email outside allowed domains is refused");
  ok((await signIn("habiba@dar.test", "s1", "other")) === BASE + "/?error=expired", "forged/expired sign-in (state mismatch) is refused");
  await signIn("habiba@dar.test"); await signIn("karim@dar.test"); await signIn("omar@dar.test"); await signIn("mona@dar.test");
  let r = await call("habiba@dar.test", "bootstrap");
  ok(r.status === 200 && r.body.me.role === "requester", "company-domain user is created as an employee on first sign-in");
  ok(r.body.cats.map(c => c.n.en).join("|") === "Request Hardware|Internet & Connectivity|Email & Accounts|New Software / License Purchase|New Joiner / Leaver|Something Else", "the six categories are seeded in order");
  ok(r.body.people.every(p => p.email === undefined) && r.body.supportEmail === undefined && r.body.canned.length === 0, "employees don't receive emails of others, support address or canned replies");
  ok((await call(null, "bootstrap")).status === 401, "not signed in → 401");

  console.log("Admin: people & departments");
  const people = async () => Object.fromEntries((await call("hany@dar.test", "bootstrap")).body.people.map(p => [p.email, p]));
  let P = await people();
  const save = (email, patch) => call("hany@dar.test", "admin-save-user", { user: { ...P[email], dept: P[email].dept, manager: P[email].manager, ...patch } });
  ok((await call("habiba@dar.test", "admin-save-user", { user: { ...P["habiba@dar.test"], role: "admin" } })).status === 403, "employee can't use admin actions");
  ok((await save("karim@dar.test", { role: "agent", dept: "it" })).status === 200, "Karim → IT agent");
  ok((await save("omar@dar.test", { role: "manager", dept: "it" })).status === 200, "Omar → IT manager");
  ok((await save("habiba@dar.test", { dept: "fin", manager: P["mona@dar.test"].id })).status === 200, "Habiba → Finance, manager Mona");
  ok((await save("hany@dar.test", { role: "requester" })).status === 400, "admin can't remove their own admin access");
  r = await call("hany@dar.test", "admin-save-user", { user: { name: "Sara Mostafa", email: "Sara@Dar.test", role: "requester", dept: "hr", active: true } });
  ok(r.status === 200 && r.body.people.some(p => p.email === "sara@dar.test"), "admin adds a person (email stored lowercase)");
  ok((await call("hany@dar.test", "admin-save-user", { user: { name: "Dup", email: "sara@dar.test", role: "requester" } })).status === 400, "duplicate email refused");
  r = await call("hany@dar.test", "admin-save-dept", { dept: { icon: "🧭", n: { en: "Product", ar: "المنتج" } } });
  const prod = Object.entries(r.body.depts).find(([, d]) => d.n.en === "Product");
  ok(prod && prod[1].n.ar === "المنتج", "admin adds a bilingual department");
  ok((await call("hany@dar.test", "admin-delete-dept", { id: "fin" })).status === 400, "department in use can't be deleted");
  ok((await call("hany@dar.test", "admin-delete-dept", { id: prod[0] })).status === 200, "unused department deleted");
  P = await people();

  console.log("Admin: categories & settings");
  r = await call("hany@dar.test", "bootstrap");
  const hw = r.body.cats.find(c => c.id === "hardware");
  r = await call("hany@dar.test", "admin-save-category", { category: { ...hw, owner: P["karim@dar.test"].id } });
  ok(r.body.cats.find(c => c.id === "hardware").owner === P["karim@dar.test"].id, "hardware auto-assigns to Karim");
  r = await call("hany@dar.test", "admin-save-category", { category: { ...hw, owner: P["habiba@dar.test"].id } });
  ok(r.body.cats.find(c => c.id === "hardware").owner === null, "non-IT person can't own a category");
  await call("hany@dar.test", "admin-save-category", { category: { ...hw, owner: P["karim@dar.test"].id } });
  ok((await call("hany@dar.test", "admin-save-settings", { values: { matrix: [["P1"]] } })).status === 400, "invalid priority matrix refused");
  r = await call("hany@dar.test", "admin-save-settings", { values: { greeting: { en: "Hello {name}", ar: "أهلًا {name}" }, csat: true } });
  ok(r.status === 200 && r.body.greeting.en === "Hello {name}", "settings saved");

  console.log("Tickets — every new ticket emails the support mailbox");
  r = await call("habiba@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "Laptop screen flickering", description: "Flickers <b>every</b> minute", fields: { device: 0, reason: 2 }, urgency: 2 } });
  const t1 = r.body.ticket;
  ok(r.status === 201 && t1.id === "IT-1001" && t1.status === "Assigned" && t1.assignee === P["karim@dar.test"].id, "IT-1001 created and auto-assigned", r.body);
  ok(mails.some(m => m.to === SUPPORT && m.subject.includes("IT-1001")), "support@company.com received IT-1001");
  ok(mails.some(m => m.to === "habiba@dar.test" && /We received/.test(m.subject)), "employee got a confirmation");
  ok(mails.some(m => m.to === "karim@dar.test" && /assigned/.test(m.subject)), "assignee was notified");
  const sm = mails.find(m => m.to === SUPPORT);
  ok(sm.html.includes("&lt;b&gt;every&lt;/b&gt;") && sm.text.includes("طلب أجهزة") && sm.text.includes("Finance"), "email is escaped, bilingual and shows the department");
  r = await call("habiba@dar.test", "create-ticket", { ticket: { category_id: "newsoft", title: "Acrobat licence", description: "Sign contracts", fields: { app: "Acrobat", why: "Contracts" } } });
  const t2 = r.body.ticket;
  ok(t2.status === "Pending Approval" && t2.approval.by === P["mona@dar.test"].id, "approval goes to the employee's manager (Mona)");
  ok(mails.some(m => m.to === "mona@dar.test" && /approval/.test(m.subject)), "manager got the approval email");
  ok((await call("habiba@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "x", description: "y", fields: { device: 0 } } })).status === 400, "missing form answer refused");
  ok((await call("habiba@dar.test", "create-ticket", { ticket: { category_id: "other", title: "x", description: "y", link: "javascript:alert(1)" } })).status === 400, "unsafe link refused");
  r = await call("mona@dar.test", "create-ticket", { ticket: { category_id: "network", title: "VPN down", description: "Nobody can connect", fields: { where: 0 }, impact: 3, urgency: 3 } });
  ok(r.body.ticket.priority === "P1" && r.body.ticket.status === "New", "whole company + can't work → P1, unassigned");
  ok(supportTicketMails().length === 3, "support received exactly one email per ticket (3/3)");

  console.log("Visibility & work");
  ok((await call("habiba@dar.test", "list-tickets")).body.length === 2, "employee sees only own tickets");
  ok((await call("mona@dar.test", "list-tickets")).body.length === 2, "manager sees own ticket + the one to approve");
  ok((await call("karim@dar.test", "list-tickets")).body.length === 3, "IT agent sees all tickets");
  ok((await call("mona@dar.test", "reply", { id: t1.id, text: "hi" })).status === 403, "others can't open someone's ticket");
  ok((await call("habiba@dar.test", "update-ticket", { id: t1.id, status: "In Progress" })).status === 403, "employee can't change status");
  await call("karim@dar.test", "reply", { id: t1.id, text: "SECRET note", internal: true });
  ok(!(await call("habiba@dar.test", "list-tickets")).body.find(x => x.id === t1.id).thread.some(m => m.text.includes("SECRET")), "internal notes never reach the employee");
  r = await call("karim@dar.test", "reply", { id: t1.id, text: "Bring it at 10am" });
  ok(r.body.ticket.status === "In Progress" && mails.some(m => m.to === "habiba@dar.test" && /New reply from IT/.test(m.subject)), "public reply → In Progress, employee emailed");
  ok((await call("karim@dar.test", "resolve", { id: t1.id, note: "" })).status === 400, "resolve needs a fix note");
  await call("karim@dar.test", "resolve", { id: t1.id, note: "Replaced cable" });
  ok((await call("habiba@dar.test", "reopen", { id: t1.id })).body.ticket.status === "In Progress", "employee can reopen");
  await call("karim@dar.test", "resolve", { id: t1.id, note: "Replaced cable again" });
  r = await call("habiba@dar.test", "confirm", { id: t1.id, csat: 5 });
  ok(r.body.ticket.status === "Closed" && r.body.ticket.csat === 5, "employee confirms & rates → Closed ★5");

  console.log("Approvals");
  ok((await call("habiba@dar.test", "approve", { id: t2.id })).status === 403, "can't approve own request");
  ok((await call("karim@dar.test", "approve", { id: t2.id })).status === 403, "agent can't approve");
  r = await call("mona@dar.test", "approve", { id: t2.id });
  ok(r.body.ticket.approval.state === "approved" && r.body.ticket.status === "New", "manager approves");
  r = await call("habiba@dar.test", "create-ticket", { ticket: { category_id: "onboard", title: "Leaver", description: "Collect laptop", fields: { kind: 1, emp: "K M", date: "2026-12-01" } } });
  r = await call("omar@dar.test", "reject", { id: r.body.ticket.id, reason: "Duplicate" });
  ok(r.body.ticket.status === "Rejected", "IT manager can reject with a reason");

  console.log("Turning someone off");
  await save("habiba@dar.test", { active: false, dept: "fin", manager: P["mona@dar.test"].id });
  ok((await call("habiba@dar.test", "bootstrap")).status === 401, "turned-off person is signed out immediately");
  ok((await signIn("habiba@dar.test")) === BASE + "/?error=disabled", "…and can't sign in again");

  console.log("Totals");
  ok(supportTicketMails().length === (await call("karim@dar.test", "list-tickets")).body.length, "support received one email for every ticket");
  const log = (await pool.query("select count(*)::int n from email_log where kind='created_support' and recipient=$1", [SUPPORT])).rows[0].n;
  ok(log === supportTicketMails().length, "every support email is recorded in email_log");

  console.log("Routing by category (technician vs. IT manager)");
  await signIn("sara@dar.test");
  P = await people();
  let cfg = (await call("hany@dar.test", "bootstrap")).body;
  const acc = cfg.cats.find(c => c.id === "account"), hw2 = cfg.cats.find(c => c.id === "hardware");
  await call("hany@dar.test", "admin-save-category", { category: { ...acc, owner: P["omar@dar.test"].id } });
  r = await call("hany@dar.test", "admin-save-category", { category: { ...hw2, notifySupport: false } });
  ok(r.body.cats.find(c => c.id === "hardware").notifySupport === false, "admin turns off the support copy for Hardware");
  let n0 = mails.length;
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "account", title: "Locked out", description: "Too many attempts", fields: { system: 0 } } });
  ok(r.body.ticket.assignee === P["omar@dar.test"].id, "Email & Accounts ticket goes to the IT manager");
  ok(mails.slice(n0).some(m => m.to === "omar@dar.test" && /assigned/.test(m.subject)) && !mails.slice(n0).some(m => m.to === "karim@dar.test"), "…manager is emailed, technician is not");
  n0 = mails.length;
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "Mouse broken", description: "Left click dead", fields: { device: 3, reason: 2 } } });
  const t5 = r.body.ticket;
  const newMails = mails.slice(n0);
  ok(t5.assignee === P["karim@dar.test"].id && newMails.some(m => m.to === "karim@dar.test"), "Hardware ticket goes to the technician");
  ok(!newMails.some(m => m.to === SUPPORT) && !newMails.some(m => m.to === "omar@dar.test"), "…and neither the support mailbox nor the manager is emailed");

  console.log("Escalation (technician → IT manager)");
  r = await call("hany@dar.test", "admin-save-settings", { values: { escalateTo: P["karim@dar.test"].id } });
  ok(r.body.escalateTo === null && r.body.escalateTarget === P["omar@dar.test"].id, "only a manager/admin can receive escalations; default is the first IT manager");
  ok((await call("sara@dar.test", "escalate", { id: t5.id, reason: "please" })).status === 403, "employee can't escalate");
  ok((await call("karim@dar.test", "escalate", { id: t5.id, reason: " " })).status === 400, "escalating needs a reason");
  n0 = mails.length;
  r = await call("karim@dar.test", "escalate", { id: t5.id, reason: "Needs a purchase approval" });
  ok(r.status === 200 && r.body.ticket.assignee === P["omar@dar.test"].id && r.body.ticket.escalated.reason === "Needs a purchase approval" && r.body.ticket.escalated.from === P["karim@dar.test"].id, "escalated ticket moves to the IT manager with reason and who it came from");
  const esc = mails.slice(n0);
  ok(esc.some(m => m.to === "omar@dar.test" && /escalated to you/.test(m.subject) && m.text.includes("Needs a purchase approval")), "IT manager is emailed with the reason");
  ok(!esc.some(m => m.to === "sara@dar.test"), "employee is not emailed about the escalation");
  ok(!(await call("sara@dar.test", "list-tickets")).body.find(x => x.id === t5.id).thread.some(m => m.text.includes("purchase approval")), "escalation reason stays internal");
  ok((await call("karim@dar.test", "escalate", { id: t5.id, reason: "again" })).status === 400, "can't escalate a ticket already with the manager");
  r = await call("omar@dar.test", "update-ticket", { id: t5.id, assignee: P["karim@dar.test"].id });
  ok(r.body.ticket.assignee === P["karim@dar.test"].id && mails.some(m => m.to === "karim@dar.test" && m.subject.includes(t5.id) && /assigned/.test(m.subject)), "manager can hand it back; technician is emailed");
  ok((await call("omar@dar.test", "escalate", { id: t5.id, reason: "x" })).status === 400, "the escalation contact can't escalate to themselves");

  console.log("Every assignment is emailed and recorded");
  const karimMails = id => mails.filter(m => m.to === "karim@dar.test" && m.subject.includes(id) && /assigned to you/.test(m.subject));
  ok(karimMails(t1.id).length >= 1 && karimMails(t1.id)[0].text.includes("Assigned automatically (category: Request Hardware)"), "auto-assignment email says it was automatic, and why");
  r = await call("karim@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "My own headset", description: "Mic broken", fields: { device: 4, reason: 2 } } });
  ok(r.body.ticket.assignee === P["karim@dar.test"].id && karimMails(r.body.ticket.id).length === 1, "technician raising a ticket in their own category still gets the assignment email");
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "other", title: "Teams camera", description: "Not detected" } });
  const u1 = r.body.ticket;
  r = await call("karim@dar.test", "update-ticket", { id: u1.id, assignee: P["karim@dar.test"].id });
  ok(r.body.ticket.assignee === P["karim@dar.test"].id && karimMails(u1.id).length === 1 && karimMails(u1.id)[0].text.includes("You took this ticket"), "taking a ticket ('Take it') sends the assignment email");
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "other", title: "Printer offline", description: "2nd floor" } });
  const u2 = r.body.ticket;
  r = await call("karim@dar.test", "reply", { id: u2.id, text: "Looking at it now" });
  ok(r.body.ticket.assignee === P["karim@dar.test"].id && karimMails(u2.id).length === 1, "replying to an unassigned ticket takes it and sends the assignment email");
  cfg = (await call("hany@dar.test", "bootstrap")).body;
  await call("hany@dar.test", "admin-save-category", { category: { ...cfg.cats.find(c => c.id === "newsoft"), owner: P["karim@dar.test"].id } });
  await call("hany@dar.test", "admin-save-user", { user: { ...P["sara@dar.test"], manager: P["mona@dar.test"].id } });
  await call("hany@dar.test", "admin-save-settings", { values: { approvalMode: "direct_manager" } });
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "newsoft", title: "Visio licence", description: "Org charts", fields: { app: "Visio", why: "HR org charts" } } });
  const ap = r.body.ticket;
  ok(ap.status === "Pending Approval" && karimMails(ap.id).length === 0, "approval request: technician isn't emailed before approval");
  await call("mona@dar.test", "approve", { id: ap.id });
  ok(karimMails(ap.id).length === 1 && karimMails(ap.id)[0].text.includes("Approved by mona"), "after approval the technician gets 'assigned to you'");
  const hist = (await call("karim@dar.test", "list-tickets")).body.find(x => x.id === t1.id).history;
  ok(hist && hist.some(h => h.type === "assigned" && h.d.en.includes("Auto-assigned to karim") && h.d.ar.includes("أُسندت تلقائيًا")), "ticket history records the automatic assignment in both languages");
  ok(hist.some(h => h.type === "resolved") && hist.some(h => h.type === "closed"), "history records resolve and confirm");
  ok((await call("sara@dar.test", "list-tickets")).body.every(x => x.history === undefined), "employees don't receive the internal history");
  const logged = (await pool.query("select count(*)::int n from email_log where kind='assigned' and recipient='karim@dar.test'")).rows[0].n;
  ok(logged === mails.filter(m => m.to === "karim@dar.test" && /assigned to you/.test(m.subject)).length, "every assignment email is recorded in email_log");

  console.log("Running with no support mailbox (IT_SUPPORT_EMAIL empty)");
  process.env.IT_SUPPORT_EMAIL = "";
  await call("hany@dar.test", "admin-save-settings", { values: { supportCcUpdates: true } });
  cfg = (await call("hany@dar.test", "bootstrap")).body;
  ok(cfg.supportEnabled === false && cfg.supportEmail === null, "app reports that there is no support mailbox");
  const noSupport0 = mails.length;
  n0 = mails.length;
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "other", title: "Strange beeping", description: "From the server room" } });
  const un = r.body.ticket;
  ok(un.status === "New" && !un.assignee, "ticket with no category owner stays unassigned");
  ok(mails.slice(n0).some(m => m.to === "omar@dar.test" && /waiting to be assigned/.test(m.subject)), "…and the escalation contact (IT manager) is emailed instead of support");
  n0 = mails.length;
  await call("sara@dar.test", "reply", { id: un.id, text: "It's getting louder" });
  ok(mails.slice(n0).some(m => m.to === "omar@dar.test" && /New reply from the employee/.test(m.subject)), "employee reply on an unassigned ticket goes to the IT manager");
  n0 = mails.length;
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "Monitor dead", description: "No power", fields: { device: 2, reason: 2 } } });
  const hwT = r.body.ticket;
  ok(mails.slice(n0).some(m => m.to === "karim@dar.test" && /assigned to you/.test(m.subject)) && !mails.slice(n0).some(m => m.to === "omar@dar.test"), "owned category: only the technician is emailed (manager not disturbed)");
  await call("karim@dar.test", "resolve", { id: hwT.id, note: "Replaced power cable" });
  await call("sara@dar.test", "reopen", { id: hwT.id });
  ok(mails.slice(n0).some(m => m.to === "karim@dar.test" && /reopened/.test(m.subject)), "reopen goes to the assigned technician");
  const after = mails.slice(noSupport0);
  ok(after.length > 0 && !after.some(m => /support@|company\.com/i.test(m.to)), "nothing is sent to any support / company.com address once it's removed");
  process.env.MAIL_FROM_ADDRESS = "it-support@dar.test";
  n0 = mails.length;
  await call("karim@dar.test", "reply", { id: hwT.id, text: "Checking again" });
  ok(mails.slice(n0).length && mails.slice(n0).every(m => /it-support@dar\.test/.test(m.from)), "optional MAIL_FROM_ADDRESS is used as the sender address");
  delete process.env.MAIL_FROM_ADDRESS;

  console.log("Assets (device inventory)");
  ok((await call("sara@dar.test", "list-assets")).status === 403, "employees can't see the inventory");
  ok((await call("sara@dar.test", "save-asset", { isNew: true, asset: { id: "LT-1", type: "laptop", model: "X", status: "in_stock" } })).status === 403, "employees can't add devices");
  r = await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "lt-0142", type: "laptop", model: "Dell Latitude 5440", serial: "SN123", owner: P["sara@dar.test"].id, status: "in_use", purchased: "2024-03-14", warranty: "2025-03-14", notes: "Charger replaced" } });
  ok(r.status === 200 && r.body.some(a => a.id === "LT-0142" && a.owner === P["sara@dar.test"].id && a.warranty === "2025-03-14"), "IT agent adds a device (tag stored in capitals, dates kept as entered)", r.body);
  ok((await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "LT-0142", type: "laptop", model: "Dup", status: "in_stock" } })).status === 400, "duplicate asset tag refused");
  ok((await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "MN-1", type: "monitor", model: "Dell P24", status: "in_stock", warranty: "2026-02-30" } })).status === 400, "invalid date refused");
  ok((await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "bad tag!", type: "monitor", model: "x", status: "in_stock" } })).status === 400, "invalid tag refused");
  ok((await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "MN-1", type: "spaceship", model: "x", status: "in_stock" } })).status === 400, "unknown device type refused");
  await call("karim@dar.test", "save-asset", { isNew: true, asset: { id: "LT-0160", type: "laptop", model: "Dell Latitude 5440", status: "in_stock", location: "IT store room" } });
  cfg = (await call("sara@dar.test", "bootstrap")).body;
  ok(cfg.myAssets.length === 1 && cfg.myAssets[0].id === "LT-0142" && cfg.assetTypes.laptop.ar === "لابتوب", "employee sees only their own device (for the ticket form)");
  n0 = mails.length;
  r = await call("sara@dar.test", "create-ticket", { ticket: { category_id: "hardware", title: "Laptop overheating", description: "Fan loud", fields: { device: 0, reason: 2 }, asset_id: "LT-0142" } });
  const at = r.body.ticket;
  ok(r.status === 201 && at.asset === "LT-0142", "employee links a ticket to their own device");
  ok(mails.slice(n0).some(m => m.to === "karim@dar.test" && m.text.includes("Device: LT-0142 · Laptop · Dell Latitude 5440") && m.text.includes("الجهاز: LT-0142")), "assignment email names the device in both languages");
  ok((await call("sara@dar.test", "create-ticket", { ticket: { category_id: "other", title: "x", description: "y", asset_id: "LT-0160" } })).status === 400, "employee can't link someone else's / a stock device");
  r = await call("karim@dar.test", "update-ticket", { id: at.id, asset: "LT-0160" });
  ok(r.body.ticket.asset === "LT-0160" && r.body.ticket.history.some(h => h.type === "asset" && h.d.en === "Device → LT-0160"), "IT can change the ticket's device; it's recorded in History");
  ok((await call("karim@dar.test", "update-ticket", { id: at.id, asset: "NOPE-1" })).status === 400, "unknown device refused");
  await call("karim@dar.test", "update-ticket", { id: at.id, asset: "LT-0142" });
  r = await call("karim@dar.test", "save-asset", { isNew: false, asset: { id: "LT-0142", type: "laptop", model: "Dell Latitude 5440", owner: null, status: "repair", location: "IT bench" } });
  ok(r.body.find(a => a.id === "LT-0142").status === "repair" && r.body.find(a => a.id === "LT-0142").owner === null, "IT edits a device (taken in for repair)");
  ok((await call("karim@dar.test", "delete-asset", { id: "LT-0160" })).status === 403, "agents can't delete devices");
  ok((await call("omar@dar.test", "delete-asset", { id: "LT-0142" })).status === 400, "a device with tickets can't be deleted (retire it instead)");
  r = await call("omar@dar.test", "delete-asset", { id: "LT-0160" });
  ok(r.status === 200 && !r.body.some(a => a.id === "LT-0160"), "IT manager deletes an unused device");
}

(async () => {
  const admin = new Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB}`);
  pool = new Pool({ database: DB });
  let server;
  try {
    await pool.query(fs.readFileSync(ROOT + "/schema.sql", "utf8"));
    await pool.query(fs.readFileSync(ROOT + "/schema.sql", "utf8")); // must be safe to re-run
    server = serve();
    await tests();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (SERVE) { console.log(`\nServing on ${BASE}  — sign in with ${BASE}/api/auth-login?as=hany@dar.test  (Ctrl+C to stop)`); return; }
  } catch (e) { console.error(e); fail++; }
  server && server.close(); await pool.end(); await admin.query(`drop database if exists ${DB}`); await admin.end();
  process.exit(fail ? 1 : 0);
})();
