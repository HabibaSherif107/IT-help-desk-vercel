// api/_stock.js — Stock register and purchase requests (not an endpoint).
// Mirrors the "IT Stock" and "IT Purchase Request" sheets:
//   • Stock: category, item, brand/model, quantity, minimum level, status, notes.
//     Status rule (same as the sheet): qty ≤ 0 → Out of Stock; qty ≤ minimum → Low Stock; else In Stock.
//     Every quantity change is logged in stock_movements (who, how many, why).
//   • Purchase requests: numbered lines (item, product link, quantity, unit price EGP, total), grand total,
//     Submitted by / Approved by with dates. Workflow: draft → submitted → approved/rejected → ordered → received.
//     Receiving adds the quantities of lines linked to stock items.
const { supabase } = require("./_db");
const IT = require("./_core");
const { sendEmail, SEP } = require("./_email");
const { check, str, isIT, isLead, itRoleOf } = IT;

const nowIso = () => new Date().toISOString();
const ms = ts => (ts ? new Date(ts).getTime() : null);
const bad = (error, status = 400) => ({ status, body: { error } });
const int = v => (typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).trim()));
const stockStatus = (q, min) => (q <= 0 ? "out" : min != null && q <= min ? "low" : "in");
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function shapeItem(r) {
  const min = r.min_level == null ? null : Number(r.min_level);
  return { id: r.id, category: r.category, name: r.name, model: r.model || "", quantity: Number(r.quantity), min,
    notes: r.notes || "", status: stockStatus(Number(r.quantity), min), updated: ms(r.updated_at) };
}
async function listStock() {
  const rows = check(await supabase.from("stock_items").select("*").order("name")) || [];
  return rows.map(shapeItem);
}
async function listPRs() {
  const prs = check(await supabase.from("purchase_requests").select("*").order("created_at", { ascending: false })) || [];
  const lines = prs.length ? check(await supabase.from("purchase_request_lines").select("*").in("pr_id", prs.map(p => p.id))) || [] : [];
  return prs.map(p => {
    const ls = lines.filter(l => l.pr_id === p.id).sort((a, b) => a.line_no - b.line_no).map(l => ({
      name: l.item_name, link: l.product_link || "", qty: Number(l.quantity), price: Number(l.unit_price),
      total: Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100, stock: l.stock_item_id || null }));
    return { id: p.id, status: p.status, notes: p.notes || "", createdBy: p.created_by, created: ms(p.created_at),
      submittedBy: p.submitted_by, submitted: ms(p.submitted_at), decidedBy: p.decided_by, decided: ms(p.decided_at),
      decisionNote: p.decision_note || "", ordered: ms(p.ordered_at), receivedBy: p.received_by, received: ms(p.received_at),
      lines: ls, total: Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100 };
  });
}
async function getPR(id) { return check(await supabase.from("purchase_requests").select("*").eq("id", str(id, 40)).maybeSingle()); }

// Every request gets its own running number: PR-00001, PR-00002 … (database sequence, never reused).
async function nextRef() {
  return check(await supabase.rpc("next_pr_id"));
}

async function cleanLines(lines) {
  if (!Array.isArray(lines)) return { error: "Add at least one item." };
  const items = (check(await supabase.from("stock_items").select("id")) || []).map(r => r.id);
  const out = [];
  for (const l of lines.slice(0, 50)) {
    const name = str(l && l.name, 150).trim();
    if (!name && !(l && (l.link || l.qty || l.price))) continue;           // skip completely empty rows
    if (!name) return { error: "Every line needs an item name." };
    const link = str(l.link, 500).trim();
    if (link && !/^https?:\/\//i.test(link)) return { error: `Line ${out.length + 1}: the product link must start with http:// or https://` };
    const qty = int(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return { error: `Line ${out.length + 1}: quantity must be a whole number of at least 1.` };
    const price = l.price === "" || l.price == null ? 0 : int(l.price);   // blank = price not known yet
    if (!isFinite(price) || price < 0 || price > 1e9) return { error: `Line ${out.length + 1}: enter a valid unit price.` };
    out.push({ line_no: out.length + 1, item_name: name, product_link: link || null, quantity: qty, unit_price: Math.round(price * 100) / 100,
      stock_item_id: l.stock && items.includes(l.stock) ? l.stock : null });
  }
  if (!out.length) return { error: "Add at least one item." };
  return { lines: out };
}

// ── Emails ────────────────────────────────────────────────────
function prBody(pr, lines, lang) {
  const total = lines.reduce((s, l) => s + l.quantity * Number(l.unit_price), 0);
  const rows = lines.map(l => `${l.line_no}. ${l.item_name} × ${l.quantity} @ ${money(l.unit_price)} = ${money(l.quantity * Number(l.unit_price))} EGP${l.product_link ? "\n   " + l.product_link : ""}`).join("\n");
  return (lang === "ar" ? `طلب الشراء: ${pr.id}\n\n${rows}\n\nالإجمالي: ${money(total)} جنيه` : `Purchase request: ${pr.id}\n\n${rows}\n\nGrand total: ${money(total)} EGP`)
    + (pr.notes ? (lang === "ar" ? `\nملاحظات: ${pr.notes}` : `\nNotes: ${pr.notes}`) : "");
}
async function emailPR(kind, pr, to, extra = {}) {
  const lines = check(await supabase.from("purchase_request_lines").select("*").eq("pr_id", pr.id).order("line_no")) || [];
  const T = {
    submitted: ["طلب شراء بحاجة لموافقتك", "Purchase request needs your approval", `أرسل ${extra.by} طلب الشراء التالي ويحتاج موافقتك. افتح مكتب الدعم ← طلبات الشراء.`, `${extra.by} submitted this purchase request for your approval. Open the Help Desk → Purchase Requests.`],
    approved: ["تمت الموافقة على طلب الشراء", "Purchase request approved", `وافق ${extra.by} على طلب الشراء.`, `${extra.by} approved the purchase request.`],
    rejected: ["تم رفض طلب الشراء", "Purchase request rejected", `رفض ${extra.by} طلب الشراء.${extra.note ? "\nالسبب: " + extra.note : ""}`, `${extra.by} rejected the purchase request.${extra.note ? "\nReason: " + extra.note : ""}`],
  }[kind];
  const body = `${T[2]}\n\n${prBody(pr, lines, "ar")}` + SEP + `${T[3]}\n\n${prBody(pr, lines, "en")}`;
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean).map(x => x.toLowerCase()))];
  await Promise.allSettled(recipients.map(r => sendEmail({
    to: r, subject: `[${pr.id}] ${T[1]} / ${T[0]}`, headline: `🧾 ${T[1]} · ${T[0]}`, body,
    link: (process.env.APP_URL || "").replace(/\/+$/, "") + "/", linkLabel: "Open / فتح", kind: "pr_" + kind, ticketId: pr.id,
  })));
}

// Returns null when the action isn't a stock / purchase-request action.
async function handle(action, { body, viewer, role, me }) {
  const ACTIONS = ["list-stock", "stock-history", "save-stock-item", "adjust-stock", "delete-stock-item",
    "list-prs", "save-pr", "submit-pr", "decide-pr", "order-pr", "receive-pr", "delete-pr"];
  if (!ACTIONS.includes(action)) return null;
  if (!isIT(role)) return bad("Only the IT team can use stock and purchase requests.", 403);

  // ── Stock ──────────────────────────────────────────────────
  if (action === "list-stock") return { body: await listStock() };

  if (action === "stock-history") {
    const rows = check(await supabase.from("stock_movements").select("*").eq("item_id", str(body.id, 40))) || [];
    return { body: rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(m => ({ change: m.change, after: m.quantity_after, reason: m.reason || "", by: m.actor_id, pr: m.pr_id, ts: ms(m.created_at) })) };
  }

  if (action === "save-stock-item") {
    const it = body.item || {};
    const name = str(it.name, 120).trim();
    if (!name) return bad("Enter the item name.");
    if (!IT.inList(await IT.loadSettings(), "stockCategories", it.category)) return bad("Choose a category.");
    let min = null;
    if (it.min !== "" && it.min != null) { min = int(it.min); if (!Number.isInteger(min) || min < 0 || min > 100000) return bad("The minimum level must be a whole number (0 or more)."); }
    const row = { name, category: it.category, model: str(it.model, 120).trim() || null, min_level: min, notes: str(it.notes, 500).trim() || null, updated_at: nowIso() };
    if (body.isNew) {
      const q = it.quantity === "" || it.quantity == null ? 0 : int(it.quantity);
      if (!Number.isInteger(q) || q < 0 || q > 1000000) return bad("The quantity must be a whole number (0 or more).");
      const ins = check(await supabase.from("stock_items").insert({ ...row, quantity: q }).select("id").single());
      if (q > 0) await supabase.from("stock_movements").insert({ item_id: ins.id, change: q, quantity_after: q, reason: "Opening stock", actor_id: viewer.id });
    } else {
      const ex = check(await supabase.from("stock_items").select("id").eq("id", str(it.id, 40)).maybeSingle());
      if (!ex) return bad("Item not found.", 404);
      check(await supabase.from("stock_items").update(row).eq("id", ex.id));   // quantity only changes through "Adjust"
    }
    return { body: await listStock() };
  }

  if (action === "adjust-stock") {
    const item = check(await supabase.from("stock_items").select("*").eq("id", str(body.id, 40)).maybeSingle());
    if (!item) return bad("Item not found.", 404);
    const change = int(body.change), reason = str(body.reason, 200).trim();
    if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 100000) return bad("Enter how many to add or remove.");
    if (!reason) return bad("Say why (e.g. “Given to Sara”, “Received from supplier”).");
    const after = Number(item.quantity) + change;
    if (after < 0) return bad(`Only ${item.quantity} in stock.`);
    check(await supabase.from("stock_items").update({ quantity: after, updated_at: nowIso() }).eq("id", item.id));
    await supabase.from("stock_movements").insert({ item_id: item.id, change, quantity_after: after, reason, actor_id: viewer.id });
    return { body: await listStock() };
  }

  if (action === "delete-stock-item") {
    if (!isLead(role)) return bad("Only the IT manager or an admin can delete stock items.", 403);
    check(await supabase.from("stock_items").delete().eq("id", str(body.id, 40)));
    return { body: await listStock() };
  }

  // ── Purchase requests ──────────────────────────────────────
  if (action === "list-prs") return { body: await listPRs() };

  if (action === "save-pr") {
    const p = body.pr || {};
    const cl = await cleanLines(p.lines);
    if (cl.error) return bad(cl.error);
    const notes = str(p.notes, 1000).trim() || null;
    let id;
    if (p.id) {
      const pr = await getPR(p.id);
      if (!pr) return bad("Purchase request not found.", 404);
      if (!["draft", "rejected"].includes(pr.status)) return bad("Only drafts or rejected requests can be edited.");
      if (pr.created_by !== viewer.id && !isLead(role)) return bad("Only the person who created it or the IT manager can edit it.", 403);
      id = pr.id;
      check(await supabase.from("purchase_requests").update({ notes, status: "draft", decided_by: null, decided_at: null, decision_note: null, updated_at: nowIso() }).eq("id", id));
      check(await supabase.from("purchase_request_lines").delete().eq("pr_id", id));
    } else {
      id = await nextRef();
      check(await supabase.from("purchase_requests").insert({ id, notes, status: "draft", created_by: viewer.id }));
    }
    check(await supabase.from("purchase_request_lines").insert(cl.lines.map(l => ({ ...l, pr_id: id }))));
    return { body: { id, prs: await listPRs() } };
  }

  const pr = await getPR(body.id);
  if (!pr) return bad("Purchase request not found.", 404);

  if (action === "submit-pr") {
    if (!["draft", "rejected"].includes(pr.status)) return bad("This request has already been submitted.");
    const n = (check(await supabase.from("purchase_request_lines").select("id").eq("pr_id", pr.id)) || []).length;
    if (!n) return bad("Add at least one item.");
    check(await supabase.from("purchase_requests").update({ status: "submitted", submitted_by: viewer.id, submitted_at: nowIso(),
      decided_by: null, decided_at: null, decision_note: null, updated_at: nowIso() }).eq("id", pr.id));
    const users = await IT.loadUsers();
    const approvers = users.filter(u => u.active !== false && isLead(itRoleOf(u)) && u.id !== viewer.id).map(u => u.email);
    await emailPR("submitted", { ...pr, id: pr.id }, approvers, { by: me.name });
    return { body: await listPRs() };
  }

  if (action === "decide-pr") {
    if (!isLead(role)) return bad("Only the IT manager or an admin can approve purchase requests.", 403);
    if (pr.status !== "submitted") return bad("This request isn't waiting for approval.");
    if (pr.submitted_by === viewer.id && role !== "admin") return bad("Another manager or an admin must approve a request you submitted.", 403);
    const approve = !!body.approve, note = str(body.note, 500).trim();
    if (!approve && !note) return bad("Give a reason for rejecting.");
    check(await supabase.from("purchase_requests").update({ status: approve ? "approved" : "rejected", decided_by: viewer.id, decided_at: nowIso(),
      decision_note: note || null, updated_at: nowIso() }).eq("id", pr.id));
    const users = await IT.loadUsers();
    const to = [pr.submitted_by, pr.created_by].map(id => (users.find(u => u.id === id) || {}).email);
    await emailPR(approve ? "approved" : "rejected", pr, to, { by: me.name, note });
    return { body: await listPRs() };
  }

  if (action === "order-pr") {
    if (pr.status !== "approved") return bad("Only approved requests can be marked as ordered.");
    check(await supabase.from("purchase_requests").update({ status: "ordered", ordered_at: nowIso(), updated_at: nowIso() }).eq("id", pr.id));
    return { body: await listPRs() };
  }

  if (action === "receive-pr") {
    if (!["approved", "ordered"].includes(pr.status)) return bad("Only approved or ordered requests can be received.");
    const lines = check(await supabase.from("purchase_request_lines").select("*").eq("pr_id", pr.id)) || [];
    for (const l of lines.filter(x => x.stock_item_id)) {
      const item = check(await supabase.from("stock_items").select("*").eq("id", l.stock_item_id).maybeSingle());
      if (!item) continue;
      const after = Number(item.quantity) + Number(l.quantity);
      check(await supabase.from("stock_items").update({ quantity: after, updated_at: nowIso() }).eq("id", item.id));
      await supabase.from("stock_movements").insert({ item_id: item.id, change: Number(l.quantity), quantity_after: after, reason: "Received from " + pr.id, actor_id: viewer.id, pr_id: pr.id });
    }
    check(await supabase.from("purchase_requests").update({ status: "received", received_by: viewer.id, received_at: nowIso(), updated_at: nowIso() }).eq("id", pr.id));
    return { body: { prs: await listPRs(), items: await listStock() } };
  }

  if (action === "delete-pr") {
    if (!["draft", "rejected"].includes(pr.status)) return bad("Only drafts or rejected requests can be deleted.");
    if (pr.created_by !== viewer.id && !isLead(role)) return bad("Only the person who created it or the IT manager can delete it.", 403);
    check(await supabase.from("purchase_requests").delete().eq("id", pr.id));
    return { body: await listPRs() };
  }
  return null;
}

module.exports = { handle, stockStatus };
