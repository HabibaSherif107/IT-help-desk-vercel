// api/app.js — the IT Help Desk API. Everything goes through
// POST /api/app { action, ... }. Identity always comes from the session
// cookie (see _session.js), never from the request body.
//
// Every new ticket is emailed to the support mailbox (IT_SUPPORT_EMAIL,
// default support@company.com) — see "create-ticket" below.
const { getUser } = require("./_session");
const IT = require("./_core");
const { supabase, check, str, bi, isColor, itRoleOf, isIT, isLead, SetupRequired } = IT;

const nowIso = () => new Date().toISOString();
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// ── Helpers ───────────────────────────────────────────────────
async function getTicketRow(id) {
  const r = await supabase.from("tickets").select("*").eq("id", String(id || "")).maybeSingle();
  return check(r);
}
async function getMessages(ids) {
  if (!ids.length) return [];
  return check(await supabase.from("ticket_messages").select("*").in("ticket_id", ids)) || [];
}
async function addEvent(ticketId, actorId, type, detail) {
  await supabase.from("ticket_events").insert({ ticket_id: ticketId, actor_id: actorId, type, detail: str(detail, 500) });
}
async function addMessage(ticketId, authorId, body, internal) {
  check(await supabase.from("ticket_messages").insert({ ticket_id: ticketId, author_id: authorId, body: str(body, 5000), internal: !!internal }));
}
async function patchTicket(id, patch) {
  check(await supabase.from("tickets").update({ ...patch, updated_at: nowIso() }).eq("id", id));
}
// Who may see a ticket, and whether they see internal notes.
function access(viewer, role, t) {
  if (isIT(role)) return { see: true, internal: true };
  if (t.requester_id === viewer.id) return { see: true, internal: false };
  if (t.approver_id === viewer.id) return { see: true, internal: false };
  return { see: false, internal: false };
}
async function shapedOne(viewer, role, id) {
  const t = await getTicketRow(id);
  const a = access(viewer, role, t);
  return IT.shapeTicket(t, await getMessages([t.id]), a.internal);
}
// Context for emails: category, people, department, settings.
async function emailCtx(t) {
  const [settings, members, catRow, deptRow] = await Promise.all([
    IT.loadSettings(), IT.loadUsers(),
    supabase.from("categories").select("*").eq("id", t.category_id).maybeSingle().then(check),
    supabase.from("departments").select("id, name").eq("id", t.dept_id || "-").maybeSingle().then(r => r.data),
  ]);
  const byId = id => members.find(m => m.id === id);
  return {
    settings, members, byId, cat: catRow,
    requester: byId(t.requester_id), assignee: byId(t.assignee_id), approver: byId(t.approver_id),
    dept: deptRow ? deptRow.name : null,
    supportCc: settings.supportCcUpdates ? IT.SUPPORT_EMAIL() : null,
  };
}

// Pick the approver for a request: the requester's manager (default) or a fixed person,
// falling back to the configured approver, then the first IT manager.
function pickApprover(settings, members, requester) {
  const valid = id => id && members.some(m => m.id === id && m.active !== false) && id !== requester.id;
  if (settings.approvalMode !== "fixed" && valid(requester.manager_id)) return requester.manager_id;
  if (valid(settings.approverId)) return settings.approverId;
  const mgr = members.find(m => itRoleOf(m) === "manager" && m.active !== false && m.id !== requester.id);
  return mgr ? mgr.id : null;
}

// ── Settings validation (admin) ───────────────────────────────
function cleanSetting(key, v, members) {
  switch (key) {
    case "autoAssign": case "kbSuggest": case "csat": case "supportCcUpdates": return !!v;
    case "approvalMode": return v === "fixed" ? "fixed" : "direct_manager";
    case "approverId": return v && members.some(m => m.id === v && m.active !== false) ? v : null;
    case "escalateTo": return v && members.some(m => m.id === v && m.active !== false && isLead(itRoleOf(m))) ? v : null;
    case "greeting": case "heroSub": return bi(v, 300);
    case "prio": {
      const o = {}; for (const p of IT.PRIOS) { const x = (v || {})[p] || {}; o[p] = { n: bi(x.n, 40), c: isColor(x.c) ? x.c : IT.DEFAULT_SETTINGS.prio[p].c }; } return o;
    }
    case "statuses": {
      const o = {}; for (const s of IT.STATUSES) { const x = (v || {})[s] || {}; o[s] = { n: bi(x.n, 40), c: isColor(x.c) ? x.c : IT.DEFAULT_SETTINGS.statuses[s].c }; } return o;
    }
    case "impacts": case "urgencies": {
      if (!Array.isArray(v) || v.length !== 3) throw new Error("Exactly three answers are needed.");
      return v.map(x => bi(x, 80));
    }
    case "matrix": {
      if (!Array.isArray(v) || v.length !== 3 || v.some(r => !Array.isArray(r) || r.length !== 3 || r.some(p => !IT.PRIOS.includes(p))))
        throw new Error("The priority matrix must be 3×3 with P1–P4 values.");
      return v.map(r => r.slice());
    }
    default: throw new Error("Unknown setting: " + key);
  }
}
function cleanCategory(c, members) {
  const id = String(c.id || "").trim();
  const owner = c.owner && members.some(m => m.id === c.owner && m.active !== false && isIT(itRoleOf(m))) ? c.owner : null;
  const fields = (Array.isArray(c.fields) ? c.fields : []).slice(0, 10).map((f, i) => {
    const kind = ["text", "select", "date"].includes(f.kind) ? f.kind : "text";
    const out = { k: /^[A-Za-z0-9_]{1,40}$/.test(f.k || "") ? f.k : "f" + i + "_" + Date.now().toString(36), kind, label: bi(f.label, 120) };
    if (kind === "select") out.opts = (Array.isArray(f.opts) ? f.opts : []).slice(0, 30).map(o => bi(o, 80)).filter(o => o.en || o.ar);
    if (f.ph) out.ph = bi(f.ph, 120);
    if (!out.label.en && !out.label.ar) throw new Error("Every question needs a label.");
    if (kind === "select" && !out.opts.length) throw new Error("Every dropdown needs at least one option.");
    return out;
  });
  const name = bi(c.n, 80);
  if (!name.en && !name.ar) throw new Error("The category needs a name.");
  return {
    id, icon: str(c.icon || "❔", 8), name, description: bi(c.d, 200),
    type: c.type === "request" ? "request" : "incident", owner_id: owner,
    needs_approval: !!c.approval, notify_support: c.notifySupport !== false, fields, active: c.active !== false,
  };
}

// ── Handler ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  const viewer = await getUser(req);
  if (!viewer) return fail(res, 401, "Not authenticated");
  const body = req.body || {};
  const action = body.action;

  try {
    const role = itRoleOf(viewer);
    const me = viewer;

    // ── Read ──────────────────────────────────────────────────
    if (action === "bootstrap") return res.status(200).json(await IT.loadConfig(viewer));

    if (action === "list-tickets") {
      let rows;
      if (isIT(role)) {
        rows = check(await supabase.from("tickets").select("*").order("created_at", { ascending: false })) || [];
      } else {
        const own = check(await supabase.from("tickets").select("*").eq("requester_id", viewer.id)) || [];
        const toApprove = check(await supabase.from("tickets").select("*").eq("approver_id", viewer.id)) || [];
        const map = new Map(); [...own, ...toApprove].forEach(t => map.set(t.id, t));
        rows = [...map.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      const msgs = await getMessages(rows.map(t => t.id));
      const by = {}; msgs.forEach(m => (by[m.ticket_id] = by[m.ticket_id] || []).push(m));
      return res.status(200).json(rows.map(t => IT.shapeTicket(t, by[t.id], access(viewer, role, t).internal)));
    }

    if (action === "kb-view") {
      const a = check(await supabase.from("kb_articles").select("id, views").eq("id", str(body.id, 40)).maybeSingle());
      if (a) await supabase.from("kb_articles").update({ views: (a.views || 0) + 1 }).eq("id", a.id);
      return res.status(200).json({ ok: true });
    }

    // ── Create a ticket (any signed-in member except read-only viewers) ──
    if (action === "create-ticket") {
      const t = body.ticket || {};
      const cat = check(await supabase.from("categories").select("*").eq("id", str(t.category_id, 60)).maybeSingle());
      if (!cat || cat.active === false) return fail(res, 400, "Please choose a category.");
      const title = str(t.title, 200).trim(), description = str(t.description, 5000).trim();
      if (!title) return fail(res, 400, "Please give your request a short title.");
      if (!description) return fail(res, 400, "Please describe the problem.");
      const fields = {};
      for (const fd of cat.fields || []) {
        let v = (t.fields || {})[fd.k];
        if (fd.kind === "select") { v = Number(v); if (!Number.isInteger(v) || v < 0 || v >= (fd.opts || []).length) return fail(res, 400, "Please fill in: " + (fd.label.en || fd.label.ar)); }
        else { v = str(v, 300).trim(); if (!v) return fail(res, 400, "Please fill in: " + (fd.label.en || fd.label.ar)); }
        fields[fd.k] = v;
      }
      const clamp = n => Math.min(3, Math.max(1, parseInt(n, 10) || 1));
      const impact = cat.type === "incident" ? clamp(t.impact) : 1, urgency = clamp(t.urgency || 2);
      const link = str(t.link, 500).trim();
      if (link && !/^https?:\/\//i.test(link)) return fail(res, 400, "The file link must start with http:// or https://");

      const [settings, members] = await Promise.all([IT.loadSettings(), IT.loadUsers()]);
      const owner = settings.autoAssign && cat.owner_id && members.some(m => m.id === cat.owner_id && m.active !== false) ? cat.owner_id : null;
      const needsApproval = !!cat.needs_approval;
      const approver = needsApproval ? pickApprover(settings, members, me) : null;
      const idRes = await supabase.rpc("next_ticket_id");
      const id = check(idRes);
      if (!id) throw new Error("Could not create a ticket number.");

      const row = {
        id, category_id: cat.id, title, description, requester_id: viewer.id, dept_id: me.dept_id || null,
        impact, urgency, priority: settings.matrix[impact - 1][urgency - 1],
        status: needsApproval ? "Pending Approval" : owner ? "Assigned" : "New",
        assignee_id: owner, fields, attachment_url: link || null,
        approval_state: needsApproval ? "pending" : null, approver_id: approver,
      };
      check(await supabase.from("tickets").insert(row));
      await addEvent(id, viewer.id, "created", "Ticket created");

      // Emails. The support mailbox gets EVERY new ticket, no matter what.
      const created = await getTicketRow(id);
      const ctx = await emailCtx(created);
      await Promise.all([
        // Support mailbox: every new ticket, unless the admin turned this off for the category.
        cat.notify_support !== false ? IT.notify("created_support", created, ctx, IT.SUPPORT_EMAIL(), {}, "created_support") : null,
        IT.notify("created_requester", created, ctx, me.email),
        needsApproval
          ? IT.notify("approval_request", created, ctx, ctx.approver && ctx.approver.email)
          : IT.notify("assigned", created, ctx, ctx.assignee && ctx.assignee.email !== me.email ? ctx.assignee.email : null),
      ]);
      return res.status(201).json({ ticket: await shapedOne(viewer, role, id) });
    }

    // ── Actions on one ticket ─────────────────────────────────
    const TICKET_ACTIONS = ["reply", "update-ticket", "resolve", "confirm", "reopen", "approve", "reject", "escalate"];
    if (TICKET_ACTIONS.includes(action)) {
      const t = await getTicketRow(body.id);
      if (!t) return fail(res, 404, "Ticket not found.");
      const a = access(viewer, role, t);
      if (!a.see) return fail(res, 403, "You can't open this ticket.");
      const mine = t.requester_id === viewer.id;

      if (action === "reply") {
        const text = str(body.text, 5000).trim();
        if (!text) return fail(res, 400, "Write a message first.");
        if (!isIT(role) && !mine) return fail(res, 403, "Only the employee who raised the ticket and IT can reply.");
        if (["Closed", "Rejected"].includes(t.status)) return fail(res, 400, "This ticket is closed.");
        const internal = isIT(role) && !!body.internal;
        await addMessage(t.id, viewer.id, text, internal);
        const patch = {};
        if (isIT(role) && !internal && ["New", "Assigned"].includes(t.status)) patch.status = "In Progress";
        if (isIT(role) && !t.assignee_id && t.status !== "Pending Approval") { patch.assignee_id = viewer.id; if (t.status === "New") patch.status = internal ? "Assigned" : "In Progress"; }
        if (!isIT(role) && t.status === "Waiting on User") patch.status = "In Progress";
        if (Object.keys(patch).length) await patchTicket(t.id, patch); else await patchTicket(t.id, {});
        if (!internal) {
          const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
          if (isIT(role)) await IT.notify("reply_to_requester", fresh, ctx, ctx.requester && ctx.requester.email, { text });
          else await IT.notify("reply_to_it", fresh, ctx, (ctx.assignee && ctx.assignee.email) || IT.SUPPORT_EMAIL(), { text });
        }
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      if (action === "update-ticket") {
        if (!isIT(role)) return fail(res, 403, "Only IT can change tickets.");
        if (!IT.OPEN_STATES.includes(t.status)) return fail(res, 400, "This ticket is no longer open.");
        const patch = {}, events = [];
        const members = await IT.loadUsers();
        if ("assignee" in body) {
          const v = body.assignee || null;
          if (v && !members.some(m => m.id === v && m.active !== false && isIT(itRoleOf(m)))) return fail(res, 400, "Tickets can only be assigned to active IT team members.");
          patch.assignee_id = v;
          if (t.status === "New" && v) patch.status = "Assigned";
          events.push(["assigned", v ? "Assigned to " + (members.find(m => m.id === v) || {}).name : "Unassigned"]);
        }
        if ("status" in body) {
          const v = body.status;
          if (t.status === "Pending Approval") return fail(res, 400, "Wait for the approval decision first.");
          if (!["New", "Assigned", "In Progress", "Waiting on User"].includes(v)) return fail(res, 400, "Use Resolve to close a ticket.");
          patch.status = v; events.push(["status", "Status → " + v]);
        }
        if ("priority" in body) {
          if (!IT.PRIOS.includes(body.priority)) return fail(res, 400, "Unknown priority.");
          patch.priority = body.priority; events.push(["priority", "Priority → " + body.priority]);
        }
        if ("major" in body) {
          if (!isLead(role)) return fail(res, 403, "Only the IT manager can declare a major incident.");
          patch.is_major = !!body.major; if (patch.is_major) patch.priority = "P1";
          events.push(["major", patch.is_major ? "Declared major incident" : "Major incident cleared"]);
        }
        await patchTicket(t.id, patch);
        for (const [type, d] of events) await addEvent(t.id, viewer.id, type, d);
        if (patch.assignee_id && patch.assignee_id !== t.assignee_id && patch.assignee_id !== viewer.id) {
          const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
          await IT.notify("assigned", fresh, ctx, ctx.assignee && ctx.assignee.email);
        }
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      // A technician hands the ticket to the IT manager: reassign + private note + email.
      if (action === "escalate") {
        if (!isIT(role)) return fail(res, 403, "Only IT can escalate tickets.");
        if (!IT.OPEN_STATES.includes(t.status) || t.status === "Pending Approval") return fail(res, 400, "This ticket can't be escalated right now.");
        const reason = str(body.reason, 1000).trim();
        if (!reason) return fail(res, 400, "Say why you're escalating.");
        const [settings, members] = await Promise.all([IT.loadSettings(), IT.loadUsers()]);
        const target = IT.pickEscalationTarget(settings, members);
        if (!target) return fail(res, 400, "Nobody is set up to receive escalations. Ask the admin to choose someone in Admin Console → General.");
        if (target === viewer.id) return fail(res, 400, "You receive escalations yourself. Assign the ticket instead.");
        if (t.assignee_id === target) return fail(res, 400, "This ticket is already with " + (members.find(m => m.id === target) || {}).name + ".");
        await addMessage(t.id, viewer.id, "⬆ " + reason, true);
        await patchTicket(t.id, { assignee_id: target, escalated_at: nowIso(), escalated_by: viewer.id, escalated_from: t.assignee_id || null, escalation_reason: reason, status: t.status === "New" ? "Assigned" : t.status });
        await addEvent(t.id, viewer.id, "escalated", "Escalated to " + (members.find(m => m.id === target) || {}).name + ": " + reason);
        const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
        await IT.notify("escalated", fresh, ctx, [ctx.assignee && ctx.assignee.email, ctx.supportCc], { text: reason, by: me.name }, "escalated");
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      if (action === "resolve") {
        if (!isIT(role)) return fail(res, 403, "Only IT can resolve tickets.");
        if (!IT.OPEN_STATES.includes(t.status) || t.status === "Pending Approval") return fail(res, 400, "This ticket can't be resolved right now.");
        const note = str(body.note, 3000).trim();
        if (!note) return fail(res, 400, "Describe the fix first.");
        await addMessage(t.id, viewer.id, "✅ " + note, false);
        await patchTicket(t.id, { status: "Resolved", resolved_at: nowIso(), assignee_id: t.assignee_id || viewer.id });
        await addEvent(t.id, viewer.id, "resolved", "Resolved");
        const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
        await IT.notify("resolved", fresh, ctx, [ctx.requester && ctx.requester.email, ctx.supportCc], { text: note });
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      if (action === "confirm") {
        if (!mine) return fail(res, 403, "Only the employee who raised the ticket can confirm it.");
        if (t.status !== "Resolved") return fail(res, 400, "This ticket isn't waiting for confirmation.");
        const csat = parseInt(body.csat, 10);
        await patchTicket(t.id, { status: "Closed", closed_at: nowIso(), csat: csat >= 1 && csat <= 5 ? csat : null });
        await addEvent(t.id, viewer.id, "closed", "Confirmed fixed" + (csat ? ` (${csat}/5)` : ""));
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      if (action === "reopen") {
        if (!mine) return fail(res, 403, "Only the employee who raised the ticket can reopen it.");
        if (t.status !== "Resolved") return fail(res, 400, "Only a resolved ticket can be reopened.");
        await addMessage(t.id, viewer.id, "🔄 " + (str(body.text, 2000).trim() || "Reopened: the issue is still happening. / أُعيد الفتح: المشكلة ما زالت قائمة."), false);
        await patchTicket(t.id, { status: "In Progress", resolved_at: null });
        await addEvent(t.id, viewer.id, "reopened", "Reopened");
        const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
        await IT.notify("reopened", fresh, ctx, [(ctx.assignee && ctx.assignee.email) || IT.SUPPORT_EMAIL(), ctx.supportCc]);
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }

      if (action === "approve" || action === "reject") {
        if (t.approval_state !== "pending") return fail(res, 400, "This request isn't waiting for approval.");
        if (!(t.approver_id === viewer.id || isLead(role))) return fail(res, 403, "Only the approver or the IT manager can decide.");
        if (t.requester_id === viewer.id && !isLead(role)) return fail(res, 403, "You can't approve your own request.");
        const reason = str(body.reason, 1000).trim();
        if (action === "approve") {
          await patchTicket(t.id, { approval_state: "approved", approver_id: viewer.id, approval_decided_at: nowIso(), status: t.assignee_id ? "Assigned" : "New" });
          await addEvent(t.id, viewer.id, "approved", "Approved");
        } else {
          await patchTicket(t.id, { approval_state: "rejected", approver_id: viewer.id, approval_reason: reason || null, approval_decided_at: nowIso(), status: "Rejected", closed_at: nowIso() });
          await addEvent(t.id, viewer.id, "rejected", "Rejected" + (reason ? ": " + reason : ""));
        }
        const fresh = await getTicketRow(t.id), ctx = await emailCtx(fresh);
        if (action === "approve") await IT.notify("approved", fresh, ctx, [ctx.requester && ctx.requester.email, ctx.assignee && ctx.assignee.email, ctx.supportCc]);
        else await IT.notify("rejected", fresh, ctx, [ctx.requester && ctx.requester.email, ctx.supportCc], { text: reason });
        return res.status(200).json({ ticket: await shapedOne(viewer, role, t.id) });
      }
    }

    // ── Admin console ─────────────────────────────────────────
    if (action && action.startsWith("admin-")) {
      if (role !== "admin") return fail(res, 403, "Only admins can change IT Help Desk settings.");
      const members = await IT.loadUsers();

      if (action === "admin-save-settings") {
        const values = body.values || {};
        const rows = Object.entries(values).map(([key, v]) => ({ key, value: cleanSetting(key, v, members), updated_at: nowIso() }));
        if (rows.length) check(await supabase.from("settings").upsert(rows, { onConflict: "key" }));
      } else if (action === "admin-save-user") {
        const u = body.user || {};
        const email = str(u.email, 200).trim().toLowerCase(), name = str(u.name, 120).trim();
        if (!name) return fail(res, 400, "Please enter a name.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, "Please enter a valid email address.");
        if (!IT.IT_ROLES.includes(u.role)) return fail(res, 400, "Unknown role.");
        const depts = check(await supabase.from("departments").select("id")) || [];
        const dept = u.dept && depts.some(d => d.id === u.dept) ? u.dept : null;
        const manager = u.manager && members.some(m => m.id === u.manager) && u.manager !== u.id ? u.manager : null;
        const row = { email, name, dept_id: dept, manager_id: manager, role: u.role, active: u.active !== false };
        const clash = members.find(m => m.email.toLowerCase() === email && m.id !== u.id);
        if (clash) return fail(res, 400, "Someone already uses that email.");
        if (u.id) {
          if (!members.some(m => m.id === u.id)) return fail(res, 404, "Person not found.");
          if (u.id === viewer.id && (row.role !== "admin" || !row.active)) return fail(res, 400, "You can't remove your own admin access.");
          check(await supabase.from("users").update(row).eq("id", u.id));
          if (!row.active) await supabase.from("sessions").delete().eq("user_id", u.id);
        } else {
          check(await supabase.from("users").insert(row));
        }
      } else if (action === "admin-save-dept") {
        const d = body.dept || {};
        const name = bi(d.n, 80);
        if (!name.en && !name.ar) return fail(res, 400, "The department needs a name.");
        const row = { name, icon: str(d.icon || "🏢", 8) };
        if (d.id) check(await supabase.from("departments").update(row).eq("id", str(d.id, 40)));
        else {
          const all = check(await supabase.from("departments").select("id, sort")) || [];
          check(await supabase.from("departments").insert({ ...row, id: "d" + Date.now().toString(36), sort: all.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1 }));
        }
      } else if (action === "admin-delete-dept") {
        const id = str(body.id, 40);
        const usedU = check(await supabase.from("users").select("id").eq("dept_id", id).limit(1)) || [];
        const usedT = check(await supabase.from("tickets").select("id").eq("dept_id", id).limit(1)) || [];
        if (usedU.length || usedT.length) return fail(res, 400, "This department still has people or tickets.");
        check(await supabase.from("departments").delete().eq("id", id));
      } else if (action === "admin-save-category") {
        const c = cleanCategory(body.category || {}, members);
        if (c.id) {
          check(await supabase.from("categories").update(c).eq("id", c.id));
        } else {
          const cats = check(await supabase.from("categories").select("id, sort")) || [];
          c.id = "c" + Date.now().toString(36);
          c.sort = cats.reduce((mx, x) => Math.max(mx, x.sort || 0), 0) + 1;
          check(await supabase.from("categories").insert(c));
        }
      } else if (action === "admin-toggle-category") {
        check(await supabase.from("categories").update({ active: !!body.active }).eq("id", str(body.id, 60)));
      } else if (action === "admin-reorder-categories") {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        for (let i = 0; i < ids.length; i++) check(await supabase.from("categories").update({ sort: i }).eq("id", str(ids[i], 60)));
      } else if (action === "admin-delete-category") {
        const used = check(await supabase.from("tickets").select("id").eq("category_id", str(body.id, 60)).limit(1)) || [];
        if (used.length) return fail(res, 400, "This category already has tickets, so it can only be hidden.");
        check(await supabase.from("categories").delete().eq("id", str(body.id, 60)));
      } else if (action === "admin-save-canned") {
        const it = body.item || {};
        const row = { title: bi(it.l, 80), body: bi(it.t, 2000) };
        if (!row.title.en && !row.title.ar) return fail(res, 400, "The reply needs a title.");
        if (it.id) check(await supabase.from("canned_replies").update(row).eq("id", it.id));
        else check(await supabase.from("canned_replies").insert({ ...row, sort: Date.now() % 100000 }));
      } else if (action === "admin-delete-canned") {
        check(await supabase.from("canned_replies").delete().eq("id", str(body.id, 60)));
      } else if (action === "admin-save-kb") {
        const a = body.article || {};
        const lines = x => (Array.isArray(x) ? x : []).map(s => str(s, 500).trim()).filter(Boolean).slice(0, 30);
        const row = { title: bi(a.t, 200), category_id: str(a.cat, 60) || null, steps: { en: lines(a.body && a.body.en), ar: lines(a.body && a.body.ar) }, updated_at: nowIso() };
        if (!row.title.en && !row.title.ar) return fail(res, 400, "The article needs a title.");
        if (a.id) check(await supabase.from("kb_articles").update(row).eq("id", a.id));
        else {
          const all = check(await supabase.from("kb_articles").select("id")) || [];
          const n = all.reduce((mx, x) => Math.max(mx, parseInt(String(x.id).replace(/\D/g, ""), 10) || 0), 0) + 1;
          check(await supabase.from("kb_articles").insert({ ...row, id: "KB-" + String(n).padStart(2, "0"), views: 0 }));
        }
      } else if (action === "admin-delete-kb") {
        check(await supabase.from("kb_articles").delete().eq("id", str(body.id, 40)));
      } else {
        return fail(res, 400, "Unknown action");
      }
      return res.status(200).json(await IT.loadConfig(viewer));
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    if (err instanceof SetupRequired) {
      console.error("app.js setup required:", err.message);
      return res.status(503).json({ error: "setup_required", detail: "Run schema.sql in the Supabase SQL Editor." });
    }
    console.error("app.js error:", action, err.message);
    return fail(res, err.message && /needs|must|Exactly|Unknown setting|Every/.test(err.message) ? 400 : 500, err.message);
  }
};
