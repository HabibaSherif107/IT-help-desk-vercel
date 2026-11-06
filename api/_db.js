// api/_db.js — the database client (not an endpoint: underscore prefix).
// All access is server-side with the service key; the browser never sees it.
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

module.exports = { supabase };
