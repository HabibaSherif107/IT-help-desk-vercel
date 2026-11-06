// api/auth-logout.js — signs the person out and returns to the sign-in page.
const { endSession } = require("./_session");

module.exports = async function handler(req, res) {
  const clear = await endSession(req);
  res.setHeader("Set-Cookie", clear);
  res.statusCode = 302;
  res.setHeader("Location", `${process.env.APP_URL || ""}/?signed_out=1`);
  res.end();
};
