// api/_session.js — sign-in sessions (not an endpoint).
// A random token in an HttpOnly cookie ("ithd_session") maps to a row in `sessions`.
const crypto = require("crypto");
const { supabase } = require("./_db");

const COOKIE = "ithd_session";
const SESSION_HOURS = 12;

function readCookie(req, name) {
  const header = (req.headers && req.headers.cookie) || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// The signed-in user, or null. Expired sessions and deactivated users are rejected.
async function getUser(req) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token || token.length < 32) return null;
    const { data: s } = await supabase.from("sessions").select("user_id, expires_at").eq("token", token).maybeSingle();
    if (!s) return null;
    if (new Date(s.expires_at) < new Date()) {
      await supabase.from("sessions").delete().eq("token", token);
      return null;
    }
    const { data: u } = await supabase.from("users")
      .select("id, email, name, dept_id, manager_id, role, active").eq("id", s.user_id).maybeSingle();
    if (!u || u.active === false) return null;
    return u;
  } catch (e) {
    console.error("Session check failed:", e.message);
    return null;
  }
}

// Creates a session and returns the Set-Cookie value for it.
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  const { error } = await supabase.from("sessions").insert({ token, user_id: userId, expires_at: expires.toISOString() });
  if (error) throw new Error("Could not start session: " + error.message);
  // Housekeeping: drop expired sessions.
  await supabase.from("sessions").delete().lt("expires_at", new Date().toISOString());
  return cookie(COOKIE, token, SESSION_HOURS * 3600);
}

// Deletes the session and returns the Set-Cookie value that clears it.
async function endSession(req) {
  const token = readCookie(req, COOKIE);
  if (token) await supabase.from("sessions").delete().eq("token", token);
  return cookie(COOKIE, "", 0);
}

module.exports = { getUser, createSession, endSession, readCookie, cookie };
