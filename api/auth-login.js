// api/auth-login.js — starts "Sign in with Zoho".
// A random `state` is stored in a short-lived cookie and checked on return,
// so nobody can trick a browser into finishing someone else's sign-in.
const crypto = require("crypto");
const { cookie } = require("./_session");

module.exports = function handler(req, res) {
  const state = crypto.randomBytes(16).toString("hex");
  const accounts = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    redirect_uri: `${process.env.APP_URL}/api/auth-callback`,
    scope: "AaaServer.profile.Read",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  res.setHeader("Set-Cookie", cookie("ithd_oauth_state", state, 600));
  res.statusCode = 302;
  res.setHeader("Location", `${accounts}/oauth/v2/auth?${params}`);
  res.end();
};
