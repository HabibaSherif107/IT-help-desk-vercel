// api/_core.js — IT Help Desk core (not an endpoint: underscore prefix).
// Defaults, permissions, config loading/seeding, ticket shaping and the
// bilingual notification emails. Used by api/app.js.
const { supabase } = require("./_db");
const { sendEmail, SEP } = require("./_email");

const B = (en, ar) => ({ en, ar });

// Optional shared support mailbox (env IT_SUPPORT_EMAIL). Empty = no support mailbox at all.
// There is deliberately NO fallback address: if it's not set, nothing is sent to "support".
const SUPPORT_EMAIL = () => {
  const v = String(process.env.IT_SUPPORT_EMAIL || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};
const APP_LINK = () => (process.env.APP_URL || "").replace(/\/+$/, "") + "/";

const IT_ROLES = ["requester", "agent", "manager", "admin"];
const STATUSES = ["New", "Pending Approval", "Assigned", "In Progress", "Waiting on User", "Resolved", "Closed", "Rejected"];
const OPEN_STATES = ["New", "Pending Approval", "Assigned", "In Progress", "Waiting on User"];
const PRIOS = ["P1", "P2", "P3", "P4"];

// ── Defaults (used until an admin saves a change) ─────────────
const DEFAULT_SETTINGS = {
  autoAssign: true,
  approvalMode: "direct_manager",       // "direct_manager" (the user's manager, fallback approverId) | "fixed"
  approverId: null,
  escalateTo: null,                     // who receives escalations (null → first active IT manager)
  kbSuggest: true,
  csat: true,
  supportCcUpdates: false,              // also copy the support mailbox on resolve / reopen / approval decisions
  greeting: B("Hi {name}, how can IT help?", "مرحبًا {name}، كيف يمكن لفريق التقنية مساعدتك؟"),
  heroSub: B("Search for a quick fix, or pick a category below to raise a ticket.", "ابحث عن حل سريع، أو اختر فئة بالأسفل لفتح تذكرة."),
  prio: { P1: { n: B("Critical", "حرجة"), c: "#EF4444" }, P2: { n: B("High", "عالية"), c: "#F97316" }, P3: { n: B("Medium", "متوسطة"), c: "#EAB308" }, P4: { n: B("Low", "منخفضة"), c: "#64748B" } },
  impacts: [B("Just me", "أنا فقط"), B("My team / department", "فريقي / قسمي"), B("The whole company", "الشركة بالكامل")],
  urgencies: [B("It can wait", "يمكنه الانتظار"), B("It's slowing me down", "يبطئ عملي"), B("I can't work at all", "لا أستطيع العمل إطلاقًا")],
  matrix: [["P4", "P3", "P3"], ["P3", "P3", "P2"], ["P3", "P2", "P1"]],   // [impact-1][urgency-1]
  statuses: {
    "New": { n: B("New", "جديدة"), c: "#38BDF8" }, "Pending Approval": { n: B("Pending Approval", "بانتظار الموافقة"), c: "#A78BFA" },
    "Assigned": { n: B("Assigned", "مُسندة"), c: "#60A5FA" }, "In Progress": { n: B("In Progress", "قيد التنفيذ"), c: "#F59E0B" },
    "Waiting on User": { n: B("Waiting on Employee", "بانتظار رد الموظف"), c: "#F472B6" }, "Resolved": { n: B("Resolved", "محلولة"), c: "#34D399" },
    "Closed": { n: B("Closed", "مغلقة"), c: "#64748B" }, "Rejected": { n: B("Rejected", "مرفوضة"), c: "#94A3B8" },
  },
};

// Device inventory: types and statuses (fixed lists, bilingual labels).
const ASSET_TYPES = {
  laptop: B("Laptop", "لابتوب"), desktop: B("Desktop", "كمبيوتر مكتبي"), monitor: B("Monitor", "شاشة"),
  printer: B("Printer / Scanner", "طابعة / ماسح ضوئي"), mobile: B("Mobile phone", "هاتف محمول"),
  network: B("Network device", "جهاز شبكة"), accessory: B("Accessory", "ملحق"), other: B("Other", "أخرى"),
};
// Company sectors (fixed list) a person belongs to.
const COMPANY_SECTORS = { shell: B("Shell", "شل"), chipsy: B("Chipsy", "شيبسي"), jammy: B("Jammy", "جامي") };
// Company sites (fixed list) where the device's holder is based.
const ASSET_LOCATIONS = { abis: B("Abis", "أبيس"), khorshid: B("Khorshid", "خورشيد"), kafr_el_sheikh: B("Kafr El Sheikh", "كفر الشيخ"), beheira: B("Beheira / Damanhour", "البحيرة / دمنهور") };
const ASSET_STATUSES = {
  in_use: { n: B("In use", "قيد الاستخدام"), c: "#34D399" }, in_stock: { n: B("In stock", "في المخزن"), c: "#38BDF8" },
  repair: { n: B("Needs repair", "يحتاج إصلاح"), c: "#F59E0B" }, retired: { n: B("Retired", "خارج الخدمة"), c: "#64748B" },
};
// Stock register categories (from the "Lists" tab of the IT Stock sheet) and purchase-request statuses.
const STOCK_CATEGORIES = {
  hardware: B("Hardware", "أجهزة"), handhelds: B("Handhelds", "أجهزة محمولة باليد"), laptops: B("Laptops", "لابتوبات"),
  cables: B("Cables & Adapters", "كابلات ومحولات"), networking: B("Networking", "شبكات"), accessories: B("Accessories", "ملحقات"),
  spare_parts: B("Spare Parts", "قطع غيار"), others: B("Others", "أخرى"),
};
const STOCK_STATUSES = { in: { n: B("In Stock", "متوفر"), c: "#34D399" }, low: { n: B("Low Stock", "مخزون منخفض"), c: "#F59E0B" }, out: { n: B("Out of Stock", "نفد المخزون"), c: "#EF4444" } };
const PR_STATUSES = {
  draft: { n: B("Draft", "مسودة"), c: "#94A3B8" }, submitted: { n: B("Waiting approval", "بانتظار الموافقة"), c: "#A78BFA" },
  approved: { n: B("Approved", "تمت الموافقة"), c: "#34D399" }, rejected: { n: B("Rejected", "مرفوض"), c: "#EF4444" },
  ordered: { n: B("Ordered", "تم الطلب"), c: "#38BDF8" }, received: { n: B("Received", "تم الاستلام"), c: "#64748B" },
};

const dateStr = v => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
function shapeAsset(a) {
  const hasWarranty = !!a.has_warranty;
  return { id: a.id, type: a.type, model: a.model || "", serial: a.serial || "", owner: a.owner_id || null,
    location: ASSET_LOCATIONS[a.location] ? a.location : "", received: a.owner_id ? dateStr(a.received_on) : null,
    status: a.status, purchased: dateStr(a.purchased_on), hasWarranty, warranty: hasWarranty ? dateStr(a.warranty_end) : null, notes: a.notes || "",
    specs: a.type === "laptop" ? cleanSpecs(a.specs) : null };
}
// Laptop specs: processor, RAM, storage, Windows 11 compatibility, expected lifetime, recommendation.
const SPEC_KEYS = { cpu: 120, ram: 60, storage: 80, lifetime: 80 };
const SPEC_RECS = ["keep", "replace_1y", "retire"];   // Keep (upgrade SSD/RAM if needed) · Replace within 1 year · Retire immediately
function cleanSpecs(v) {
  const o = v && typeof v === "object" ? v : {};
  const out = {};
  for (const k in SPEC_KEYS) out[k] = String(o[k] == null ? "" : o[k]).slice(0, SPEC_KEYS[k]).trim();
  out.win11 = ["yes", "no"].includes(o.win11) ? o.win11 : "";
  out.recommendation = SPEC_RECS.includes(o.recommendation) ? o.recommendation : "";
  return out;
}

const opt = (en, ar) => B(en, ar);
const DEFAULT_CATEGORIES = [
  { id: "hardware", icon: "💻", type: "request", needs_approval: false, name: B("Request Hardware", "طلب أجهزة"),
    description: B("New or replacement laptop, screen or mouse, or report a broken device", "لابتوب أو شاشة أو ماوس جديد أو بديل، أو الإبلاغ عن جهاز معطل"),
    fields: [{ k: "device", kind: "select", label: B("Which device?", "أي جهاز؟"), opts: [opt("Laptop", "لابتوب"), opt("Desktop", "كمبيوتر مكتبي"), opt("Monitor", "شاشة"), opt("Keyboard / Mouse", "لوحة مفاتيح / ماوس"), opt("Headset", "سماعة"), opt("Other", "أخرى")] },
             { k: "reason", kind: "select", label: B("Reason", "السبب"), opts: [opt("New request", "طلب جديد"), opt("Replacement", "استبدال"), opt("Broken device", "جهاز معطل")] }] },
  { id: "network", icon: "📶", type: "incident", needs_approval: false, name: B("Internet & Connectivity", "الإنترنت والاتصال"),
    description: B("No internet, slow Wi-Fi, VPN won't connect", "لا يوجد إنترنت، أو الواي فاي بطيء، أو الـVPN لا يتصل"),
    fields: [{ k: "where", kind: "select", label: B("Where are you?", "أين أنت؟"), opts: [opt("Head office", "المقر الرئيسي"), opt("Factory / Site", "المصنع / الموقع"), opt("Working from home", "العمل من المنزل")] }] },
  { id: "account", icon: "🔑", type: "incident", needs_approval: false, name: B("Email & Accounts", "البريد الإلكتروني والحسابات"),
    description: B("Password reset, locked account, access to a shared folder", "إعادة تعيين كلمة المرور، حساب مقفل، صلاحية مجلد مشترك"),
    fields: [{ k: "system", kind: "select", label: B("Which account?", "أي حساب؟"), opts: [opt("Zoho Mail", "Zoho Mail"), opt("Windows login", "تسجيل دخول ويندوز"), opt("ERP", "نظام ERP"), opt("Shared drive", "المجلد المشترك"), opt("Other", "أخرى")] }] },
  { id: "newsoft", icon: "🛒", type: "request", needs_approval: true, name: B("New Software / License Purchase", "شراء برنامج / ترخيص جديد"),
    description: B("Buy or install a paid application", "شراء أو تثبيت برنامج مدفوع"),
    fields: [{ k: "app", kind: "text", label: B("Software name", "اسم البرنامج"), ph: B("e.g. Adobe Acrobat Pro", "مثال: Adobe Acrobat Pro") },
             { k: "why", kind: "text", label: B("Business reason", "سبب الحاجة للعمل"), ph: B("Why do you need it?", "لماذا تحتاجه؟") }] },
  { id: "onboard", icon: "🧑‍💼", type: "request", needs_approval: true, name: B("New Joiner / Leaver", "موظف جديد / مغادر"),
    description: B("Set up or remove laptop, email and accounts", "تجهيز أو سحب اللابتوب والبريد والحسابات"),
    fields: [{ k: "kind", kind: "select", label: B("Joining or leaving?", "انضمام أم مغادرة؟"), opts: [opt("New joiner", "موظف جديد"), opt("Leaver", "موظف مغادر")] },
             { k: "emp", kind: "text", label: B("Employee name", "اسم الموظف"), ph: B("Full name", "الاسم الكامل") },
             { k: "date", kind: "date", label: B("Start date / last day", "تاريخ البدء / آخر يوم") }] },
  { id: "other", icon: "❓", type: "incident", needs_approval: false, name: B("Something Else", "شيء آخر"),
    description: B("Not sure? Describe it and IT will route it", "غير متأكد؟ اشرح المشكلة وسيقوم فريق التقنية بتوجيهها"), fields: [] },
];
const DEFAULT_CANNED = [
  { title: B("Acknowledge", "تأكيد الاستلام"), body: B("Hi, thanks for reaching out. I'm looking into this now and will update you shortly.", "مرحبًا، شكرًا لتواصلك. أعمل على طلبك الآن وسأوافيك بالتحديث قريبًا.") },
  { title: B("Need more info", "طلب معلومات"), body: B("Could you send a screenshot of the error and tell me when it started?", "هل يمكنك إرسال لقطة شاشة للخطأ وإخباري متى بدأت المشكلة؟") },
  { title: B("Remote session", "جلسة عن بُعد"), body: B("I'd like to connect remotely. Please open AnyDesk and send me the 9-digit code.", "أود الاتصال بجهازك عن بُعد. يُرجى فتح AnyDesk وإرسال الرمز المكوّن من 9 أرقام.") },
  { title: B("Restart first", "أعد التشغيل أولًا"), body: B("Please restart your device fully and let me know if the issue continues.", "يُرجى إعادة تشغيل جهازك بالكامل وإخباري إذا استمرت المشكلة.") },
  { title: B("Fixed, please confirm", "تم الإصلاح، يُرجى التأكيد"), body: B("I've applied a fix. Could you confirm everything works on your side?", "قمت بتطبيق الإصلاح. هل يمكنك التأكد من أن كل شيء يعمل لديك؟") },
];
const DEFAULT_KB = [
  { id: "KB-01", category_id: "account", title: B("How to reset your Zoho Mail password", "كيفية إعادة تعيين كلمة مرور Zoho Mail"),
    steps: { en: ["Go to accounts.zoho.com and click “Forgot password”.", "Enter your work email and the code sent to your phone.", "Choose a new password of 12 or more characters.", "If you are locked out after 5 attempts, raise an Email & Accounts ticket."],
             ar: ["ادخل إلى accounts.zoho.com واضغط «نسيت كلمة المرور».", "أدخل بريدك الإلكتروني للعمل والرمز المرسل إلى هاتفك.", "اختر كلمة مرور جديدة من 12 حرفًا أو أكثر.", "إذا قُفل حسابك بعد 5 محاولات، افتح تذكرة في فئة البريد الإلكتروني والحسابات."] } },
  { id: "KB-02", category_id: "network", title: B("Wi-Fi is slow or keeps disconnecting", "الواي فاي بطيء أو ينقطع باستمرار"),
    steps: { en: ["Forget the network and reconnect.", "Move closer to an access point; meeting rooms have the strongest signal.", "Restart your laptop. If the whole floor is affected, raise a ticket and choose “My team / department”."],
             ar: ["احذف الشبكة من الجهاز ثم اتصل بها مجددًا.", "اقترب من نقطة الاتصال، فقاعات الاجتماعات بها أقوى إشارة.", "أعد تشغيل اللابتوب. إذا تأثر الدور بالكامل، افتح تذكرة واختر «فريقي / قسمي»."] } },
  { id: "KB-03", category_id: "hardware", title: B("Laptop is running slowly", "اللابتوب يعمل ببطء"),
    steps: { en: ["Restart it. Many issues clear after a restart.", "Check free disk space; it needs at least 15% free.", "Close browser tabs you aren't using.", "If it's older than 4 years, request a replacement under Request Hardware."],
             ar: ["أعد تشغيله، فكثير من المشكلات تُحل بعد إعادة التشغيل.", "تحقق من المساحة الفارغة على القرص، يجب ألا تقل عن 15%.", "أغلق علامات تبويب المتصفح غير المستخدمة.", "إذا كان عمره أكثر من 4 سنوات، اطلب بديلًا من فئة طلب أجهزة."] } },
];

// ── Permissions ───────────────────────────────────────────────
function itRoleOf(user) {
  return user && IT_ROLES.includes(user.role) ? user.role : "requester";
}
const isIT = r => r === "agent" || r === "manager" || r === "admin";
const isLead = r => r === "manager" || r === "admin";

// Who receives an escalation: the chosen person if they're an active IT manager/admin,
// otherwise the first active IT manager, otherwise the first active admin.
function pickEscalationTarget(settings, users) {
  const lead = u => u && u.active !== false && (itRoleOf(u) === "manager" || itRoleOf(u) === "admin");
  const chosen = users.find(u => u.id === settings.escalateTo);
  if (lead(chosen)) return chosen.id;
  const mgr = users.find(u => u.active !== false && itRoleOf(u) === "manager");
  if (mgr) return mgr.id;
  const adm = users.find(u => u.active !== false && itRoleOf(u) === "admin");
  return adm ? adm.id : null;
}

// ── Small validators ──────────────────────────────────────────
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const bi = (v, max = 300) => ({ en: str(v && v.en, max).trim(), ar: str(v && v.ar, max).trim() });
const isColor = c => /^#[0-9a-fA-F]{6}$/.test(String(c || ""));

// ── Data access ───────────────────────────────────────────────
// Thrown when the tables don't exist yet (schema.sql not run).
class SetupRequired extends Error {}
function check(res) {
  if (res.error) {
    const m = res.error.message || "";
    if (/does not exist|relation|schema cache/i.test(m)) throw new SetupRequired(m);
    throw new Error(m);
  }
  return res.data;
}

async function loadUsers() {
  return check(await supabase.from("users").select("*").order("name")) || [];
}

async function loadSettings() {
  const rows = check(await supabase.from("settings").select("key, value")) || [];
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s;
}

// Seed the editable lists the first time the help desk is opened.
async function seedIfEmpty() {
  const cats = check(await supabase.from("categories").select("id"));
  if (!cats || cats.length === 0) {
    check(await supabase.from("categories").insert(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, owner_id: null, sort: i, active: true }))));
  }
  const canned = check(await supabase.from("canned_replies").select("id"));
  if (!canned || canned.length === 0) {
    check(await supabase.from("canned_replies").insert(DEFAULT_CANNED.map((c, i) => ({ ...c, sort: i }))));
  }
  const kb = check(await supabase.from("kb_articles").select("id"));
  if (!kb || kb.length === 0) {
    check(await supabase.from("kb_articles").insert(DEFAULT_KB.map(k => ({ ...k, views: 0 }))));
  }
}

// Everything the page needs to draw itself, in the shape the front end uses.
async function loadConfig(viewer) {
  await seedIfEmpty();
  const [settings, users, deptRows, catRows, cannedRows, kbRows, myAssetRows] = await Promise.all([
    loadSettings(), loadUsers(),
    supabase.from("departments").select("id, name, icon, sort").order("sort").then(check),
    supabase.from("categories").select("*").order("sort").then(check),
    supabase.from("canned_replies").select("*").order("sort").then(check),
    supabase.from("kb_articles").select("*").order("id").then(check),
    supabase.from("assets").select("*").eq("owner_id", viewer.id).order("id").then(check),
  ]);
  const role = itRoleOf(viewer);
  const depts = {};
  for (const d of deptRows || []) depts[d.id] = { n: d.name || B(d.id, d.id), icon: d.icon || "🏢", sort: d.sort || 0 };
  return {
    me: { id: viewer.id, role, name: viewer.name },
    supportEmail: isLead(role) ? SUPPORT_EMAIL() : undefined,
    supportEnabled: !!SUPPORT_EMAIL(),
    autoAssign: settings.autoAssign, approvalMode: settings.approvalMode, approver: settings.approverId,
    kbSuggest: settings.kbSuggest, csat: settings.csat, supportCcUpdates: settings.supportCcUpdates,
    escalateTo: settings.escalateTo, escalateTarget: pickEscalationTarget(settings, users),
    assetTypes: ASSET_TYPES, assetStatuses: ASSET_STATUSES, assetLocations: ASSET_LOCATIONS, sectors: COMPANY_SECTORS,
    stockCategories: STOCK_CATEGORIES, stockStatuses: STOCK_STATUSES, prStatuses: PR_STATUSES,
    myAssets: (myAssetRows || []).filter(a => a.status !== "retired").map(shapeAsset),
    greeting: settings.greeting, heroSub: settings.heroSub,
    prio: settings.prio, impacts: settings.impacts, urgencies: settings.urgencies, matrix: settings.matrix, statuses: settings.statuses,
    depts,
    people: users.map(u => ({
      id: u.id, name: u.name, dept: u.dept_id, sector: COMPANY_SECTORS[u.sector] ? u.sector : null, role: itRoleOf(u), active: u.active !== false,
      ...(role === "admin" ? { email: u.email, manager: u.manager_id } : {}),
    })),
    cats: (catRows || []).map(c => ({ id: c.id, icon: c.icon, active: c.active !== false, type: c.type, owner: c.owner_id, approval: !!c.needs_approval, notifySupport: c.notify_support !== false, n: c.name, d: c.description || B("", ""), fields: c.fields || [] })),
    canned: isIT(role) ? (cannedRows || []).map(c => ({ id: c.id, l: c.title, t: c.body })) : [],
    kb: (kbRows || []).map(k => ({ id: k.id, cat: k.category_id, views: k.views || 0, t: k.title, body: k.steps || { en: [], ar: [] } })),
  };
}

// ── Ticket shaping ────────────────────────────────────────────
const ms = ts => (ts ? new Date(ts).getTime() : null);
// History entries store their text as {"en","ar"} JSON (older entries may be plain text).
const parseDetail = d => { try { const o = JSON.parse(d); return o && typeof o === "object" ? o : d; } catch (_) { return d; } };
function shapeTicket(t, messages, includeInternal, events) {
  return {
    id: t.id, cat: t.category_id, title: t.title, desc: t.description, req: t.requester_id, dept: t.dept_id,
    impact: t.impact, urgency: t.urgency, priority: t.priority, status: t.status, assignee: t.assignee_id,
    created: ms(t.created_at), updated: ms(t.updated_at), resolved: ms(t.resolved_at), csat: t.csat,
    fields: t.fields || {}, link: t.attachment_url, major: !!t.is_major, asset: t.asset_id || null,
    approval: t.approval_state ? { by: t.approver_id, state: t.approval_state, reason: t.approval_reason } : null,
    escalated: t.escalated_at ? { at: ms(t.escalated_at), by: t.escalated_by, from: t.escalated_from, reason: t.escalation_reason } : null,
    history: includeInternal ? (events || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(ev => ({ by: ev.actor_id, ts: ms(ev.created_at), type: ev.type, d: parseDetail(ev.detail) })) : undefined,
    thread: (messages || []).filter(m => includeInternal || !m.internal)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(m => ({ by: m.author_id, ts: ms(m.created_at), text: m.body, internal: !!m.internal })),
  };
}

// ── Notification emails (bilingual: Arabic first, then English) ──
const fieldLines = (cat, fields, lang) => (cat && cat.fields || []).map(fd => {
  const v = (fields || {})[fd.k];
  if (v == null || v === "") return null;
  const val = fd.kind === "select" ? ((fd.opts || [])[v] || {})[lang] || ((fd.opts || [])[v] || {}).en || "" : String(v);
  return `${(fd.label || {})[lang] || (fd.label || {}).en}: ${val}`;
}).filter(Boolean).join("\n");

function ticketSummary(t, ctx, lang) {
  const { cat, requester, assignee, dept, settings } = ctx;
  const prio = (settings.prio[t.priority] || {}).n || {};
  const L = o => (o && (o[lang] || o.en)) || "";
  const lines = lang === "ar"
    ? [`التذكرة: ${t.id} - ${t.title}`, `الفئة: ${L(cat && cat.name)}`, `الأولوية: ${t.priority} · ${L(prio)}`, `مقدم الطلب: ${requester ? requester.name : "-"}${dept ? " (" + (L(dept)) + ")" : ""}`, `المسؤول: ${assignee ? assignee.name : "غير مُسندة"}`]
    : [`Ticket: ${t.id} - ${t.title}`, `Category: ${L(cat && cat.name)}`, `Priority: ${t.priority} · ${L(prio)}`, `Requester: ${requester ? requester.name : "-"}${dept ? " (" + L(dept) + ")" : ""}`, `Assigned to: ${assignee ? assignee.name : "Unassigned"}`];
  if (ctx.asset) {
    const a = ctx.asset, ty = L(ASSET_TYPES[a.type]);
    lines.push((lang === "ar" ? "الجهاز: " : "Device: ") + [ty, a.model, a.serial ? "SN " + a.serial : ""].filter(Boolean).join(" · "));
  }
  const extra = fieldLines(cat, t.fields, lang);
  return lines.join("\n") + (extra ? "\n" + extra : "");
}

// kind: created_support | created_requester | assigned | approval_request | approved | rejected |
//       reply_to_requester | reply_to_it | resolved | reopened
function buildEmail(kind, t, ctx, extra = {}) {
  const sAr = ticketSummary(t, ctx, "ar"), sEn = ticketSummary(t, ctx, "en");
  const note = extra.text ? String(extra.text) : "";
  const T = {
    created_support: ["تذكرة تقنية جديدة", "New IT ticket", `تم فتح تذكرة جديدة في مكتب دعم تقنية المعلومات.\n\n${sAr}\n\nالتفاصيل:\n${t.description}`, `A new ticket was raised in the IT Help Desk.\n\n${sEn}\n\nDetails:\n${t.description}`],
    created_requester: ["تم استلام طلبك", "We received your request", `شكرًا لك، تم استلام طلبك وسيتابعه فريق التقنية.\n\n${sAr}`, `Thank you, your request was received and IT will follow up.\n\n${sEn}`],
    assigned: ["أُسندت إليك تذكرة", "A ticket was assigned to you", `أُسندت إليك هذه التذكرة.${extra.how ? "\n" + extra.how.ar : ""}\n\n${sAr}\n\nالتفاصيل:\n${t.description}`, `This ticket was assigned to you.${extra.how ? "\n" + extra.how.en : ""}\n\n${sEn}\n\nDetails:\n${t.description}`],
    approval_request: ["مطلوب موافقتك", "Your approval is needed", `هذا الطلب يحتاج موافقتك قبل أن يبدأ فريق التقنية العمل. افتح مكتب الدعم ثم «الموافقات».\n\n${sAr}\n\nالتفاصيل:\n${t.description}`, `This request needs your approval before IT starts work. Open the Help Desk, then Approvals.\n\n${sEn}\n\nDetails:\n${t.description}`],
    approved: ["تمت الموافقة على الطلب", "Request approved", `تمت الموافقة على الطلب وبدأ فريق التقنية العمل عليه.\n\n${sAr}`, `The request was approved and IT can start work.\n\n${sEn}`],
    rejected: ["تم رفض الطلب", "Request rejected", `تم رفض الطلب.${note ? "\nالسبب: " + note : ""}\n\n${sAr}`, `The request was rejected.${note ? "\nReason: " + note : ""}\n\n${sEn}`],
    reply_to_requester: ["رد جديد من فريق التقنية", "New reply from IT", `${note}\n\n${sAr}`, `${note}\n\n${sEn}`],
    reply_to_it: ["رد جديد من الموظف", "New reply from the employee", `${note}\n\n${sAr}`, `${note}\n\n${sEn}`],
    resolved: ["تم حل تذكرتك", "Your ticket was resolved", `حدد فريق التقنية هذه التذكرة كمحلولة. افتح مكتب الدعم لتأكيد الحل وتقييمه، أو لإعادة فتحها.\nالحل: ${note}\n\n${sAr}`, `IT marked this ticket as resolved. Open the Help Desk to confirm and rate the fix, or reopen it.\nFix: ${note}\n\n${sEn}`],
    escalated: ["تم تصعيد تذكرة إليك", "Ticket escalated to you", `صعّد ${extra.by || "فريق التقنية"} هذه التذكرة إليك.\nالسبب: ${note}\n\n${sAr}\n\nالتفاصيل:\n${t.description}`, `${extra.by || "IT"} escalated this ticket to you.\nReason: ${note}\n\n${sEn}\n\nDetails:\n${t.description}`],
    unassigned_new: ["تذكرة جديدة بانتظار الإسناد", "New ticket waiting to be assigned", `فُتحت تذكرة جديدة ولم تُسند لأحد. يُرجى إسنادها من قائمة التذاكر ← غير مُسندة.\n\n${sAr}\n\nالتفاصيل:\n${t.description}`, `A new ticket was raised and nobody is assigned to it. Please assign it from Ticket Queue → Unassigned.\n\n${sEn}\n\nDetails:\n${t.description}`],
    reopened: ["أُعيد فتح التذكرة", "Ticket reopened", `أعاد الموظف فتح التذكرة لأن المشكلة ما زالت قائمة.\n\n${sAr}`, `The employee reopened the ticket because the issue is still happening.\n\n${sEn}`],
  }[kind];
  const [hAr, hEn, bAr, bEn] = T;
  return {
    subject: `[${t.id}] ${hEn} / ${hAr}: ${t.title}`,
    headline: `🖥️ ${hEn} · ${hAr}`,
    body: bAr + SEP + bEn,
  };
}

// Send one notification; `to` may be a list. Duplicates and blanks are dropped.
async function notify(kind, t, ctx, toList, extra = {}, logKind) {
  const recipients = [...new Set((Array.isArray(toList) ? toList : [toList]).filter(Boolean).map(x => x.toLowerCase()))];
  if (!recipients.length) return [];
  const mail = buildEmail(kind, t, ctx, extra);
  return Promise.allSettled(recipients.map(to => sendEmail({
    to, subject: mail.subject, headline: mail.headline, body: mail.body,
    link: APP_LINK(), linkLabel: "Open ticket / فتح التذكرة",
    kind: logKind || kind, ticketId: t.id,
  })));
}

module.exports = {
  supabase, SUPPORT_EMAIL, IT_ROLES, STATUSES, OPEN_STATES, PRIOS, DEFAULT_SETTINGS,
  itRoleOf, isIT, isLead, pickEscalationTarget, ASSET_TYPES, ASSET_STATUSES, ASSET_LOCATIONS, COMPANY_SECTORS, shapeAsset, cleanSpecs, dateStr, STOCK_CATEGORIES, STOCK_STATUSES, PR_STATUSES, str, bi, isColor, check, SetupRequired,
  loadUsers, loadSettings, loadConfig, shapeTicket, notify, buildEmail,
};
