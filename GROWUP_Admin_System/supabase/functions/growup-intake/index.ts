// GROWUP public consultation intake — Supabase Edge Function (Deno)
// Public endpoint: validates input, rejects honeypot/spam, inserts using server credentials,
// then sends a notification. Never expose service-role or Resend keys to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const STATUSES = ["New", "Contacted", "Qualified", "Consultation Scheduled", "Proposal Sent", "Negotiation", "Converted", "Not Converted"];
const MAX = { name: 120, company: 160, designation: 120, email: 254, phone: 30, industry: 100, details: 3000, method: 50, source: 500, time: 40 };
const memoryRate = new Map<string, { count: number; reset: number }>();

function response(body: Record<string, unknown>, status = 200, origin = "") {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, idempotency-key");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(JSON.stringify(body), { status, headers });
}
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const escapeHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function rateLimit(key: string) {
  // Best-effort per-isolate limiter. Use Turnstile and/or a shared rate-limit service for production scale.
  const now = Date.now(), current = memoryRate.get(key);
  if (!current || current.reset < now) { memoryRate.set(key, { count: 1, reset: now + 10 * 60_000 }); return true; }
  current.count += 1; return current.count <= 5;
}

Deno.serve(async (req) => {
  const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim().replace(/\/$/, "") ?? "";
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowedOrigin = configuredOrigin || requestOrigin;
  if (configuredOrigin && requestOrigin && requestOrigin.replace(/\/$/, "") !== configuredOrigin) return response({ success: false, message: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return response({}, 204, allowedOrigin);
  if (req.method !== "POST") return response({ success: false, message: "Method not allowed." }, 405, allowedOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL");
  const notifyEmail = Deno.env.get("NOTIFICATION_EMAIL") || "growupcosting@gmail.com";
  if (!supabaseUrl || !serviceKey) return response({ success: false, message: "Submission service is not configured." }, 503, allowedOrigin);

  let raw: Record<string, unknown>;
  try { raw = await req.json(); if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid body"); }
  catch { return response({ success: false, message: "Please submit a valid form." }, 400, allowedOrigin); }

  // A filled honeypot is silently accepted to avoid giving bots useful feedback; nothing is stored.
  if (clean(raw.website, 200)) return response({ success: true, reference: "", notificationSent: true }, 200, allowedOrigin);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
  if (!rateLimit(ip)) return response({ success: false, message: "Too many attempts. Please wait a few minutes and try again." }, 429, allowedOrigin);

  const name = clean(raw.name, MAX.name), company = clean(raw.company, MAX.company), designation = clean(raw.designation, MAX.designation);
  const email = clean(raw.email, MAX.email).toLowerCase(), phone = clean(raw.phone, MAX.phone), industry = clean(raw.industry, MAX.industry);
  const details = clean(raw.details, MAX.details), method = clean(raw.method, MAX.method), source = clean(raw.source, MAX.source);
  const preferredDate = clean(raw.preferred_consultation_date || raw.date, 10), preferredTime = clean(raw.preferred_time || raw.time, MAX.time);
  const consent = raw.consent === true || raw.consent === "true" || raw.consent === "on";
  const services = Array.isArray(raw.services_required) ? [...new Set(raw.services_required.map(v => clean(v, 120)).filter(Boolean))].slice(0, 20) : [];
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneValid = /^[+\d()\-.\s]{7,30}$/.test(phone);
  const methodValid = ["Online Meeting", "Phone Call", "WhatsApp", "On-site Consultation"].includes(method);
  if (!name || !company || !emailValid || !phoneValid || !industry || details.length < 10 || !methodValid || !services.length || !consent) {
    return response({ success: false, message: "Some required information is missing or invalid. Please review the form and try again." }, 422, allowedOrigin);
  }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return response({ success: false, message: "Please select a valid consultation date." }, 422, allowedOrigin);
  if (new TextEncoder().encode(details).length > 12000) return response({ success: false, message: "Requirement description is too long." }, 422, allowedOrigin);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Prevent rapid double clicks/retries for the same request without trusting client-supplied IDs.
  const duplicateSince = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: recent, error: duplicateError } = await supabase.from("leads").select("id,created_at,notification_status").eq("email", email).eq("phone", phone).eq("details", details).gte("created_at", duplicateSince).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!duplicateError && recent) {
    return response({ success: true, reference: String(recent.id).slice(0, 8).toUpperCase(), notificationSent: recent.notification_status === "sent", duplicate: true }, 200, allowedOrigin);
  }

  const now = new Date().toISOString();
  const payload = {
    name, company, designation: designation || null, email, phone, industry, services_required: services,
    details, method, preferred_consultation_date: preferredDate || null, preferred_time: preferredTime || null,
    consent, consent_at: now, source: source || null, status: STATUSES[0], notes: "", updated_at: now,
    notification_status: "pending", notification_attempts: 0,
  };
  const { data: lead, error: insertError } = await supabase.from("leads").insert(payload).select("id,created_at").single();
  if (insertError || !lead) {
    console.error("Lead insert failed", insertError?.code || "unknown");
    return response({ success: false, message: "We could not save your request. Please try again or contact GROWUP directly." }, 500, allowedOrigin);
  }

  let notificationSent = false, notificationError: string | null = null;
  if (!resendKey || !fromEmail) notificationError = "Email provider is not configured";
  else {
    const adminUrl = (Deno.env.get("ADMIN_DASHBOARD_URL") || `${configuredOrigin || requestOrigin}/admin.html`).replace(/\/$/, "");
    const submittedAt = new Date(lead.created_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" });
    const subject = `New GROWUP consultation — ${String(lead.id).slice(0, 8).toUpperCase()} — ${name}`;
    const rows: [string, string][] = [
      ["Reference", String(lead.id).slice(0, 8).toUpperCase()], ["Submitted", submittedAt], ["Name", name], ["Company", company],
      ["Designation", designation || "Not provided"], ["Email", email], ["Phone / WhatsApp", phone], ["Industry", industry],
      ["Services", services.join(", ")], ["Requirement", details], ["Preferred contact", method],
      ["Preferred date", preferredDate || "Not specified"], ["Preferred time", preferredTime || "Not specified"],
    ];
    const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17243a"><h2 style="color:#19866a">New GROWUP consultation request</h2><p>A new request was saved in the central lead database.</p><table cellpadding="9" cellspacing="0" style="border-collapse:collapse;width:100%">${rows.map(([k,v]) => `<tr><th align="left" valign="top" style="background:#f4f6f8;border:1px solid #e2e7ec;width:180px">${escapeHtml(k)}</th><td style="border:1px solid #e2e7ec;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join("")}</table><p style="margin-top:24px"><a href="${escapeHtml(adminUrl)}" style="background:#19866a;color:white;padding:12px 18px;text-decoration:none;border-radius:6px">Open Admin Dashboard</a></p></div>`;
    try {
      const mailRes = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: fromEmail, to: [notifyEmail], subject, html }) });
      if (!mailRes.ok) { notificationError = `Email provider returned ${mailRes.status}`; console.error("Resend delivery request failed", mailRes.status); }
      else notificationSent = true;
    } catch (err) { notificationError = "Email provider request failed"; console.error("Resend request failed", err instanceof Error ? err.name : "unknown"); }
  }
  const updatePatch = { notification_status: notificationSent ? "sent" : "failed", notification_attempts: 1, notification_last_error: notificationError, notification_updated_at: new Date().toISOString() };
  const { error: notificationUpdateError } = await supabase.from("leads").update(updatePatch).eq("id", lead.id);
  if (notificationUpdateError) console.error("Could not update notification status", notificationUpdateError.code || "unknown");
  return response({ success: true, reference: String(lead.id).slice(0, 8).toUpperCase(), notificationSent }, 200, allowedOrigin);
});
