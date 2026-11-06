// api/auth-callback.js — Zoho sends people back here after they sign in.
// 1) check `state`, 2) swap the code for a token, 3) read the person's email,
// 4) find or create their user, 5) start a session.
const { supabase } = require("./_db");
const { createSession, readCookie, cookie } = require("./_session");

const list = v => String(v || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);

function redirect(res, path, cookies) {
  if (cookies && cookies.length) res.setHeader("Set-Cookie", cookies);
  res.statusCode = 302;
  res.setHeader("Location", `${process.env.APP_URL || ""}${path}`);
  res.end();
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const clearState = cookie("ithd_oauth_state", "", 0);
  if (q.error || !q.code) return redirect(res, "/?error=denied", [clearState]);
  const expected = readCookie(req, "ithd_oauth_state");
  if (!expected || q.state !== expected) return redirect(res, "/?error=expired", [clearState]);

  try {
    const accounts = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/+$/, "");
    const tokenRes = await fetch(`${accounts}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.ZOHO_CLIENT_ID || "",
        client_secret: process.env.ZOHO_CLIENT_SECRET || "",
        redirect_uri: `${process.env.APP_URL}/api/auth-callback`,
        code: String(q.code),
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error("Zoho did not return an access token");

    const infoRes = await fetch(`${accounts}/oauth/user/info`, { headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` } });
    const info = await infoRes.json();
    const email = String(info.Email || info.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Zoho did not return an email address");
    const zohoName = String(info.Display_Name || [info.First_Name, info.Last_Name].filter(Boolean).join(" ") || email.split("@")[0]).slice(0, 120);

    const admins = list(process.env.BOOTSTRAP_ADMIN_EMAILS);
    const domains = list(process.env.ALLOWED_EMAIL_DOMAINS);
    const isBootstrapAdmin = admins.includes(email);

    const { data: found, error: findErr } = await supabase.from("users").select("id, name, role, active").eq("email", email).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    let user = found;

    if (!user) {
      // New person: allowed if listed as a starting admin, or on an allowed company domain.
      if (!isBootstrapAdmin && !domains.includes(email.split("@")[1])) return redirect(res, "/?error=not_registered", [clearState]);
      const { error } = await supabase.from("users").insert({ email, name: zohoName, role: isBootstrapAdmin ? "admin" : "requester", active: true });
      if (error) throw new Error(error.message);
      const { data } = await supabase.from("users").select("id, name, role, active").eq("email", email).maybeSingle();
      user = data;
    }
    if (!user || user.active === false) return redirect(res, "/?error=disabled", [clearState]);

    const patch = { last_login_at: new Date().toISOString() };
    if (isBootstrapAdmin && user.role !== "admin") patch.role = "admin";
    await supabase.from("users").update(patch).eq("id", user.id);

    const sessionCookie = await createSession(user.id);
    return redirect(res, "/", [sessionCookie, clearState]);
  } catch (err) {
    console.error("Sign-in failed:", err.message);
    return redirect(res, "/?error=server", [clearState]);
  }
};
