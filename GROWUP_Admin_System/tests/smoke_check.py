from pathlib import Path
import re, subprocess, sys
ROOT = Path(__file__).resolve().parents[1]
errors=[]
for name in ("index.html", "admin.html"):
    p=ROOT/name
    if not p.exists(): errors.append(f"Missing {name}"); continue
    html=p.read_text(encoding="utf-8")
    if html.lower().count("<html") != 1 or html.lower().count("</html>") != 1: errors.append(f"{name}: HTML root mismatch")
    if "SUPABASE_SERVICE_ROLE_KEY" in html or "RESEND_API_KEY" in html: errors.append(f"{name}: private secret name appears in frontend")
    blocks=re.findall(r'<script\b[^>]*>([\s\S]*?)</script\s*>', html, re.I)
    for i, js in enumerate(x for x in blocks if x.strip()):
        temp=Path("/tmp")/f"growup-{name}-{i}.js"
        temp.write_text(js, encoding="utf-8")
        result=subprocess.run(["node", "--check", str(temp)], capture_output=True, text=True)
        if result.returncode: errors.append(f"{name}: inline script syntax: {result.stderr.strip()}")
function=ROOT/"supabase/functions/growup-intake/index.ts"
for path in (ROOT/"supabase/schema.sql", function, ROOT/"README-SETUP.md", ROOT/".env.example", ROOT/"netlify.toml"):
    if not path.exists() or path.stat().st_size == 0: errors.append(f"Missing/empty deliverable: {path.relative_to(ROOT)}")
if "create policy \"Admins can read leads\"" not in (ROOT/"supabase/schema.sql").read_text(): errors.append("Lead read RLS policy missing")
if "notification_status" not in (ROOT/"supabase/schema.sql").read_text(): errors.append("Notification tracking schema missing")
if "YOUR_SUPABASE_SERVICE_ROLE_KEY" not in (ROOT/".env.example").read_text(): errors.append("Environment example should contain a placeholder for the service role key")
if errors:
    print("FAIL")
    print("\n".join("- "+e for e in errors))
    sys.exit(1)
print("PASS: HTML roots and inline JavaScript syntax")
print("PASS: Frontend does not contain private service/email credentials")
print("PASS: Required backend/schema/setup files exist")
print("PASS: RLS and notification tracking markers found")
print("NOTE: These are static smoke checks only; live provider/database/browser tests require project credentials and deployment.")
