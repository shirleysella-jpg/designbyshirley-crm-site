// designbyshirley CRM — single-page app on Supabase.
// The publishable key below is meant to be public; access is enforced by row level security.

const SUPABASE_URL = "https://fsygskqtzlegktwhivej.supabase.co";
const SUPABASE_KEY = "sb_publishable_K26rM_RD4giaWqMcNPewlg_0JyZe4LW";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PROJECTS_ROOT = "C:\\Users\\user\\Desktop\\MY PROJECTS\\NEW\\";
const TYPES = { F: "שיפוץ מלא כולל הלבשה", R: "שיפוץ בלי הלבשה", S: "הלבשה בלבד", N: "דירה מקבלן עם שינויי דיירים" };
const PROJECT_STATUSES = ["הצעת מחיר נשלחה", "פעיל, בתכנון", "פעיל, בביצוע", "מושהה", "הסתיים"];
const TASK_STATUSES = ["לא התחיל", "בעבודה", "ממתין לאישור לקוח", "ממתין לבעל מקצוע או לספק", "הושלם", "לא רלוונטי"];
const WAITING = ["ממתין לאישור לקוח", "ממתין לבעל מקצוע או לספק"];
// Color marks: 1 red = urgent, 2 orange = immediate, 3 green = not urgent, null = no mark
const MARKS = [[1, "דחוף"], [2, "מיידי"], [3, "לא דחוף"]];
const CATEGORIES = ["עסק", "חשבונות", "שיווק", "אישי", "ילדים"];
const CONTACT_KINDS = ["קבלן", "נגר", "אלומיניום", "ספק מטבחים", "ספק ריצוף וחיפוי", "ספק תאורה", "ספק ריהוט", "יזם / חברה קבלנית", "לקוח", "אחר"];
const VAT = 0.18;
const FOLLOW_UP_DAYS = 7;

const state = { session: null, openStages: new Set(), projectTab: "stages", projectFilter: "פעילים", generalFilter: "הכול" };
const app = document.getElementById("app");

// Helpers --------------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const today = () => new Date().toLocaleDateString("sv-SE");
function addDays(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); }
function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }
function fmt(iso) { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}.${m}.${y.slice(2)}`; }
function money(n) { return n == null || n === "" ? "—" : "₪" + Number(n).toLocaleString("he-IL", { maximumFractionDigits: 2 }); }
const isDone = t => t.status === "הושלם";
const isOpen = t => t.status !== "הושלם" && t.status !== "לא רלוונטי";

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
// Replace the page; keep the scroll position when re-rendering the same view
function paint(key, ...nodes) {
  const y = state.painted === key ? window.scrollY : 0;
  app.replaceChildren(...nodes.flat().filter(n => n != null && n !== false));
  window.scrollTo(0, y);
  state.painted = key;
}
function fail(error) { console.error(error); toast("משהו לא נשמר: " + (error.message || error)); }
async function run(q) { const { data, error } = await q; if (error) { fail(error); throw error; } return data; }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("הועתק"); }
  catch { prompt("העתיקי:", text); }
}

// Two-step confirmation inside the button itself
function confirmButton(label, onConfirm, cls = "btn small danger") {
  const b = h("button", { class: cls, type: "button", text: label });
  let armed = false, timer;
  b.addEventListener("click", () => {
    if (!armed) { armed = true; b.textContent = "בטוח? ללחוץ שוב"; timer = setTimeout(() => { armed = false; b.textContent = label; }, 3000); return; }
    clearTimeout(timer); onConfirm();
  });
  return b;
}

function select(options, value, onChange, attrs = {}) {
  const s = h("select", attrs);
  for (const o of options) {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    s.append(h("option", { value: val, text: label }));
  }
  s.value = value ?? "";
  if (onChange) s.addEventListener("change", () => onChange(s.value));
  return s;
}
// Three colored dots; clicking the chosen color again clears it
function markPicker(value, onChange) {
  const wrap = h("span", { class: "marks", role: "group", "aria-label": "סימון בצבע" });
  for (const [v, label] of MARKS) {
    wrap.append(h("button", { type: "button", class: `mark m${v}`, title: label, "aria-label": label, "aria-pressed": String(value === v),
      on: { click: e => { e.stopPropagation(); onChange(value === v ? null : v); } } }));
  }
  wrap.addEventListener("keydown", e => e.stopPropagation());
  return wrap;
}
// Dates: typed as day/month/year (1/12/2026, 1.12.26, 1/12) or picked from a calendar
function parseDate(s) {
  s = (s || "").trim();
  if (!s) return "";
  let d, mo, y, m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else {
    m = s.match(/^(\d{1,2})\s*[\/.\-\s]\s*(\d{1,2})(?:\s*[\/.\-\s]\s*(\d{2}|\d{4}))?$/);
    if (!m) return null;
    [d, mo] = [+m[1], +m[2]];
    y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const showDate = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
function dateField(value, onChange, label) {
  let current = value || "";
  const text = h("input", { type: "text", class: "date-text", inputmode: "numeric", dir: "ltr", placeholder: "יום/חודש/שנה", value: showDate(current), "aria-label": label || "תאריך" });
  const native = h("input", { type: "date", class: "date-native", tabindex: "-1", "aria-hidden": "true", value: current });
  const btn = h("button", { type: "button", class: "date-btn", title: "בחירה מלוח שנה", "aria-label": "בחירה מלוח שנה", text: "📅" });
  const commit = iso => { current = iso; text.value = showDate(iso); native.value = iso; text.classList.remove("invalid"); if (onChange) onChange(iso || null); };
  text.addEventListener("change", () => {
    const iso = parseDate(text.value);
    if (iso === null) { text.classList.add("invalid"); toast("התאריך לא ברור. כותבים למשל 1/12/2026"); return; }
    if (iso !== current) commit(iso); else { text.value = showDate(iso); text.classList.remove("invalid"); }
  });
  native.addEventListener("change", () => commit(native.value));
  btn.addEventListener("click", () => { try { native.showPicker(); } catch { native.focus(); } });
  const wrap = h("span", { class: "datef" }, text, btn, native);
  Object.defineProperty(wrap, "value", { get: () => current });
  return wrap;
}
function field(label, input, cls) { return h("label", { class: "field" + (cls ? " " + cls : "") }, label, input); }

function openPanel(title, body, actions) {
  const overlay = h("div", { class: "overlay", on: { click: e => { if (e.target === overlay) overlay.remove(); } } });
  const close = () => overlay.remove();
  overlay.append(h("div", { class: "panel", role: "dialog", "aria-label": title },
    h("h2", { text: title }), body, h("div", { class: "row" }, ...actions(close), h("span", { class: "spacer" }),
      h("button", { class: "btn ghost", type: "button", text: "ביטול", on: { click: close } }))));
  document.body.append(overlay);
  const first = overlay.querySelector("input, select, textarea"); if (first) first.focus();
  return close;
}

// Task updates shared by every screen ----------------------------------------
async function updateTask(task, patch) {
  if ("status" in patch) {
    patch.done_at = patch.status === "הושלם" ? today() : null;
    if (WAITING.includes(patch.status)) { if (!task.waiting_since) patch.waiting_since = today(); }
    else patch.waiting_since = null;
  }
  const row = await run(db.from("tasks").update(patch).eq("id", task.id).select().single());
  Object.assign(task, row);
  return row;
}

// Auth -----------------------------------------------------------------------
function renderLogin(mode = "in", message = "") {
  document.getElementById("top").hidden = true;
  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true });
  const pass = h("input", { type: "password", id: "password", autocomplete: mode === "in" ? "current-password" : "new-password", required: true, minlength: "8" });
  const err = h("p", { class: "err", role: "alert", text: message });
  const form = h("form", { class: "card" },
    field("מייל", email), field("סיסמה", pass),
    err,
    h("button", { class: "btn", type: "submit", text: mode === "in" ? "כניסה" : "פתיחת חשבון" }));
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    if (mode === "in") {
      const { error } = await db.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) err.textContent = error.message === "Invalid login credentials" ? "המייל או הסיסמה לא נכונים." : error.message;
    } else {
      const { data, error } = await db.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: location.origin } });
      if (error) err.textContent = /closed|Database error/i.test(error.message) ? "אפשר לפתוח חשבון רק עם המייל של שירלי." : error.message;
      else if (!data.session) renderLogin("in", "נשלח אלייך מייל אישור. אחרי הלחיצה על הקישור במייל, חזרי לכאן והיכנסי.");
    }
  });
  app.replaceChildren(h("div", { class: "login" },
    h("span", { class: "brand", text: "designbyshirley" }),
    h("h1", { text: mode === "in" ? "כניסה למערכת הפרויקטים" : "פתיחת חשבון" }),
    form,
    h("button", { class: "link", type: "button", text: mode === "in" ? "עוד אין לך חשבון? פתיחת חשבון" : "כבר יש לך חשבון? כניסה",
      on: { click: () => renderLogin(mode === "in" ? "up" : "in") } })));
}

document.getElementById("signout").addEventListener("click", () => db.auth.signOut());

// Router -----------------------------------------------------------------------
async function route() {
  if (!state.session) return renderLogin();
  document.getElementById("top").hidden = false;
  state.painted = null;
  const hash = location.hash || "#/";
  const [, view, id] = hash.split("/");
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on",
    (a.dataset.nav === "projects" && (!view || view === "p")) || a.dataset.nav === view));
  try {
    if (view === "p" && id) await renderProject(Number(id));
    else if (view === "today") await renderToday();
    else if (view === "general") await renderGeneral();
    else if (view === "income") await renderIncome();
    else if (view === "contacts") await renderContacts();
    else await renderProjects();
  } catch (e) { if (!e.code) fail(e); }
}
window.addEventListener("hashchange", route);

// Projects list ------------------------------------------------------------------
function projectSummary(p) {
  const relevant = (p.tasks || []).filter(t => t.status !== "לא רלוונטי");
  const done = relevant.filter(isDone).length;
  const stages = (p.stages || []).slice().sort((a, b) => a.position - b.position);
  const current = stages.find(s => !s.done_at);
  const t = today();
  return {
    pct: relevant.length ? Math.round(done / relevant.length * 100) : 0,
    done, total: relevant.length,
    current: current ? current.name : (stages.length ? "כל השלבים הושלמו" : "אין שלבים"),
    late: relevant.filter(x => isOpen(x) && x.due_date && x.due_date < t).length,
    waiting: relevant.filter(x => WAITING.includes(x.status)).length
  };
}

async function renderProjects() {
  const projects = await run(db.from("projects").select("*, stages(id,name,position,done_at), tasks(id,status,due_date)").order("number", { ascending: false, nullsFirst: false }));
  const filters = ["פעילים", ...PROJECT_STATUSES, "הכול"];
  const shown = projects.filter(p => state.projectFilter === "הכול" ? true
    : state.projectFilter === "פעילים" ? p.status.startsWith("פעיל") : p.status === state.projectFilter);

  const list = shown.length ? h("div", { class: "plist" }, shown.map(p => {
    const s = projectSummary(p);
    return h("a", { class: "pcard", href: `#/p/${p.id}` },
      h("div", { class: "title" }, h("span", { class: "no", text: p.number ?? "–" }), h("span", { class: "name", text: p.name })),
      h("div", { class: "row" }, h("span", { class: "pill oak", text: TYPES[p.project_type] }), h("span", { class: "pill", text: p.status })),
      h("p", { class: "small" }, h("span", { class: "muted", text: "שלב נוכחי: " }), s.current),
      h("div", { class: "bar", "aria-label": `${s.pct}% הושלם` }, h("i", { style: `width:${s.pct}%` })),
      h("div", { class: "row small" },
        h("span", { class: "muted num", text: `${s.done}/${s.total} משימות` }),
        s.late ? h("span", { class: "pill late", text: `${s.late} באיחור` }) : null,
        s.waiting ? h("span", { class: "pill wait", text: `${s.waiting} ממתינות` }) : null));
  })) : h("div", { class: "empty" }, projects.length ? "אין פרויקטים בסטטוס הזה." : "עוד אין פרויקטים. לחצי על \"פרויקט חדש\" כדי לפתוח את הראשון.");

  paint("projects",
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "פרויקטים" }), h("p", { class: "sub num", text: `${projects.filter(p => p.status.startsWith("פעיל")).length} פעילים` })),
      h("button", { class: "btn", type: "button", text: "פרויקט חדש", on: { click: () => projectForm(null, projects) } })),
    h("div", { class: "filters" }, filters.map(f => h("button", { class: "chip" + (f === state.projectFilter ? " on" : ""), type: "button", text: f,
      on: { click: () => { state.projectFilter = f; renderProjects(); } } }))),
    list);
}

function projectForm(p, all = []) {
  const isNew = !p;
  const nextNo = Math.max(0, ...all.map(x => x.number || 0)) + 1;
  p = p || { number: nextNo, project_type: "F", status: "פעיל, בתכנון", billing: "global" };
  const f = {
    number: h("input", { type: "number", value: p.number ?? "" }),
    name: h("input", { type: "text", value: p.name || "", required: true, placeholder: "למשל: משפחת כהן" }),
    project_type: select(Object.entries(TYPES), p.project_type),
    status: select(PROJECT_STATUSES, p.status),
    billing: select([["global", "מחיר גלובלי"], ["hourly", "לפי שעות"]], p.billing),
    address: h("input", { type: "text", value: p.address || "" }),
    city: h("input", { type: "text", value: p.city || "" }),
    property_type: select(["", "דירה", "בית פרטי", "פנטהאוז", "דירת גן", "מסחרי"], p.property_type || ""),
    rooms: h("input", { type: "text", value: p.rooms || "", placeholder: "סלון, מטבח, 3 חדרי שינה…" }),
    start_date: dateField(p.start_date),
    handover_date: dateField(p.handover_date),
    target_date: dateField(p.target_date),
    folder_name: h("input", { type: "text", value: p.folder_name || "", placeholder: "171_Cohen Family" }),
    budget: h("input", { type: "number", value: p.budget ?? "" }),
    notes: h("textarea", { value: p.notes || "" })
  };
  const body = h("div", { class: "form-grid" },
    field("מספר פרויקט", f.number), field("שם הלקוחות", f.name), field("סוג פרויקט", f.project_type), field("סטטוס", f.status),
    field("תמחור", f.billing), field("סוג הנכס", f.property_type), field("כתובת", f.address), field("עיר", f.city),
    field("חדרים", f.rooms, "wide"), field("תאריך התחלה", f.start_date), field("מסירה מהקבלן / כניסה", f.handover_date),
    field("יעד לסיום", f.target_date), field("תקציב הלקוח", f.budget), field("שם התיקייה ב-MY PROJECTS\\NEW", f.folder_name, "wide"),
    field("הערות", f.notes, "wide"),
    isNew ? h("p", { class: "small muted wide", text: "השלבים והמשימות ייפתחו אוטומטית לפי סוג הפרויקט." })
          : h("p", { class: "small muted wide", text: "שינוי סוג הפרויקט לא משנה שלבים שכבר נפתחו. מחיקת פרויקט מוחקת אותו רק מהמערכת, לא מהמחשב." }));
  openPanel(isNew ? "פרויקט חדש" : "עריכת פרטי הפרויקט", body, close => [
    h("button", { class: "btn", type: "button", text: isNew ? "פתיחת הפרויקט" : "שמירה", on: { click: async () => {
      if (!f.name.value.trim()) { f.name.focus(); return; }
      const row = {};
      for (const [k, el] of Object.entries(f)) {
        const v = el.value.trim ? el.value.trim() : el.value;
        row[k] = v === "" ? null : (k === "number" || k === "budget") ? Number(v) : v;
      }
      if (isNew) {
        const created = await run(db.from("projects").insert(row).select().single());
        await run(db.rpc("instantiate_project", { p_project: created.id }));
        close(); toast("הפרויקט נפתח עם כל השלבים"); location.hash = `#/p/${created.id}`;
      } else {
        await run(db.from("projects").update(row).eq("id", p.id));
        close(); toast("נשמר"); route();
      }
    } } }),
    isNew ? null : confirmButton("מחיקת הפרויקט מהמערכת", async () => {
      await run(db.from("projects").delete().eq("id", p.id));
      close(); toast("הפרויקט נמחק מהמערכת. התיקייה במחשב לא נגעה."); location.hash = "#/";
    })
  ].filter(Boolean));
}

// Project page ------------------------------------------------------------------
async function renderProject(id) {
  const [p, stages, tasks, dists, pays, questions, meetings, pcontacts, items] = await Promise.all([
    run(db.from("projects").select("*").eq("id", id).single()),
    run(db.from("stages").select("*").eq("project_id", id).order("position")),
    run(db.from("tasks").select("*").eq("project_id", id).order("position")),
    run(db.from("distributions").select("*").eq("project_id", id).order("dist_date", { ascending: false })),
    run(db.from("payments").select("*").eq("project_id", id).order("position")),
    run(db.from("questions").select("*").eq("project_id", id).order("created_at")),
    run(db.from("meetings").select("*").eq("project_id", id).order("meet_date", { ascending: false })),
    run(db.from("project_contacts").select("*, contacts(*)").eq("project_id", id)),
    run(db.from("items").select("*").eq("project_id", id).order("position").order("id"))
  ]);
  const ctx = { p, stages, tasks, dists, pays, questions, meetings, pcontacts, items };
  const s = projectSummary({ ...p, stages, tasks });
  const hours = tasks.reduce((a, t) => a + Number(t.hours || 0), 0);
  const path = p.folder_name ? PROJECTS_ROOT + p.folder_name : null;

  const facts = h("div", { class: "facts" },
    h("span", {}, "סוג: ", h("b", { text: TYPES[p.project_type] })),
    h("span", {}, "סטטוס: ", h("b", { text: p.status })),
    p.city || p.address ? h("span", {}, "כתובת: ", h("b", { text: [p.address, p.city].filter(Boolean).join(", ") })) : null,
    p.start_date ? h("span", {}, "התחלה: ", h("b", { class: "num", text: fmt(p.start_date) })) : null,
    p.handover_date ? h("span", {}, "מסירה: ", h("b", { class: "num", text: fmt(p.handover_date) })) : null,
    p.target_date ? h("span", {}, "יעד: ", h("b", { class: "num", text: fmt(p.target_date) })) : null,
    p.billing === "hourly" || hours ? h("span", {}, "שעות: ", h("b", { class: "num", text: hours.toLocaleString("he-IL") })) : null,
    p.budget ? h("span", {}, "תקציב: ", h("b", { class: "num", text: money(p.budget) })) : null);

  const tabs = [["stages", `שלבים ${s.done}/${s.total}`], ["items", `חומרים ורכישות ${items.length || ""}`.trim()], ["dists", `מסמכים שנשלחו ${dists.length}`], ["pays", "תשלומים"],
    ["questions", `שאלות ללקוח ${questions.filter(q => !q.answered_at).length || ""}`.trim()], ["meetings", "פגישות"], ["contacts", "אנשי קשר"], ["folder", "תיקייה"]];
  const body = { stages: stagesTab, items: itemsTab, dists: distsTab, pays: paysTab, questions: questionsTab, meetings: meetingsTab, contacts: contactsTab, folder: folderTab }[state.projectTab] || stagesTab;

  const bodyEl = await body(ctx);
  paint("p" + id,
    h("div", { class: "page-head" },
      h("div", {}, h("p", { class: "small" }, h("a", { href: "#/", text: "פרויקטים" }), " / "),
        h("h1", { text: `${p.number ? p.number + " · " : ""}${p.name}` })),
      h("div", { class: "row" },
        path ? h("button", { class: "btn ghost", type: "button", text: "העתקת נתיב התיקייה", on: { click: () => copyText(path) } }) : null,
        h("button", { class: "btn ghost", type: "button", text: "שינוי בתכנון", on: { click: () => changePanel(ctx) } }),
        h("button", { class: "btn ghost", type: "button", text: "עריכת פרטים", on: { click: () => projectForm(p) } }))),
    facts,
    p.notes ? h("p", { class: "muted", text: p.notes }) : null,
    h("div", { class: "bar" }, h("i", { style: `width:${s.pct}%` })),
    h("div", { class: "tabs", role: "tablist" }, tabs.map(([k, label]) => h("button", { class: "tab" + (state.projectTab === k ? " on" : ""), type: "button", role: "tab", text: label,
      on: { click: () => { state.projectTab = k; renderProject(id); } } }))),
    bodyEl);
}

function taskRow(t, opts = {}) {
  const row = h("div", { class: "task" + (isDone(t) ? " is-done" : "") + (t.status === "לא רלוונטי" ? " is-na" : "") + (t.priority ? ` marked m${t.priority}` : "") });
  const cb = h("input", { type: "checkbox", checked: isDone(t), "aria-label": "בוצע: " + t.name });
  cb.addEventListener("change", async () => { await updateTask(t, { status: cb.checked ? "הושלם" : "לא התחיל" }); opts.onChange?.(t); });
  const name = h("div", { class: "tname" }, t.name, t.optional ? h("span", { class: "opt-mark", text: "לפעמים" }) : null,
    opts.projectLabel ? h("div", { class: "proj" }, opts.projectLabel) : null,
    WAITING.includes(t.status) && t.waiting_on ? h("div", { class: "proj", text: "ממתין ל: " + t.waiting_on }) : null);
  const late = isOpen(t) && t.due_date && t.due_date < today();
  const waitDays = WAITING.includes(t.status) && t.waiting_since ? daysBetween(t.waiting_since, today()) : 0;
  const extra = h("div", { class: "extra", hidden: true });
  const ctrls = h("div", { class: "ctrls" },
    late ? h("span", { class: "pill late", text: "באיחור" }) : null,
    waitDays >= FOLLOW_UP_DAYS ? h("span", { class: "pill wait", text: `${waitDays} ימים בלי תשובה` }) : null,
    select(TASK_STATUSES, t.status, async v => { await updateTask(t, { status: v }); opts.onChange?.(t); }, { "aria-label": "סטטוס" }),
    markPicker(t.priority, async v => { await updateTask(t, { priority: v }); opts.onChange ? opts.onChange(t) : null; }),
    dateField(t.due_date, async v => { await updateTask(t, { due_date: v }); opts.onChange?.(t); }, "תאריך יעד"),
    h("button", { class: "link small", type: "button", text: "עוד", on: { click: () => { extra.hidden = !extra.hidden; } } }));
  extra.append(
    h("div", { class: "row" },
      field("ממתין ל (מי צריך להחזיר תשובה)", h("input", { type: "text", value: t.waiting_on || "", placeholder: "לקוח, נגר, ספק…", on: { change: e => updateTask(t, { waiting_on: e.target.value || null }) } })),
      opts.rooms !== false ? field("חדר", h("input", { type: "text", value: t.room || "", on: { change: e => updateTask(t, { room: e.target.value || null }) } })) : null,
      field("שעות עבודה", h("input", { type: "number", step: "0.25", min: "0", value: t.hours ?? 0, on: { change: e => updateTask(t, { hours: Number(e.target.value || 0) }) } })),
      opts.categories ? field("קטגוריה", select(["", ...CATEGORIES], t.category || "", v => updateTask(t, { category: v || null }))) : null),
    field("הערות", h("textarea", { value: t.notes || "", on: { change: e => updateTask(t, { notes: e.target.value || null }) } })),
    h("div", { class: "row" }, confirmButton("מחיקת המשימה", async () => { await run(db.from("tasks").delete().eq("id", t.id)); row.remove(); toast("נמחק"); opts.onDelete?.(t); })));
  row.append(cb, name, ctrls, extra);
  return row;
}

// Recompute stage completion after a task changes
async function syncStage(stage, stageTasks, ctx) {
  const relevant = stageTasks.filter(t => t.status !== "לא רלוונטי");
  const complete = relevant.length > 0 && relevant.every(isDone);
  if (complete && !stage.done_at) {
    stage.done_at = today();
    await run(db.from("stages").update({ done_at: stage.done_at }).eq("id", stage.id));
    const unpaid = ctx.pays.filter(x => !x.paid_at);
    toast(`השלב "${stage.name}" הושלם.` + (unpaid.length ? " יש תשלום לגבות?" : ""));
    return true;
  }
  if (!complete && stage.done_at) {
    stage.done_at = null;
    await run(db.from("stages").update({ done_at: null }).eq("id", stage.id));
    return true;
  }
  return false;
}

function stagesTab(ctx) {
  const { stages, tasks, p } = ctx;
  if (!stages.length) return h("div", { class: "empty" }, "אין שלבים בפרויקט.");
  const current = stages.find(s => !s.done_at);
  if (state.openStagesFor !== p.id) { state.openStagesFor = p.id; state.openStages = new Set(current ? [current.id] : []); }
  return h("div", { class: "group" }, stages.map((s, i) => {
    const st = tasks.filter(t => t.stage_id === s.id);
    const relevant = st.filter(t => t.status !== "לא רלוונטי");
    const done = relevant.filter(isDone).length;
    const late = s.due_date && !s.done_at && s.due_date < today();
    const open = state.openStages.has(s.id);
    const card = h("section", { class: "stage" + (s === current ? " current" : "") + (s.priority ? ` marked m${s.priority}` : "") });
    const head = h("div", { class: "stage-head", role: "button", tabindex: "0", "aria-expanded": String(open) },
      h("span", { class: "sno", text: String(i + 1) }), h("h3", { text: s.name }),
      markPicker(s.priority, async v => { await run(db.from("stages").update({ priority: v }).eq("id", s.id)); s.priority = v; renderProject(p.id); }),
      s.done_at ? h("span", { class: "pill done", text: "הושלם " + fmt(s.done_at) }) : null,
      s === current ? h("span", { class: "pill oak", text: "שלב נוכחי" }) : null,
      late ? h("span", { class: "pill late", text: "באיחור" }) : null,
      h("span", { class: "muted small num", text: `${done}/${relevant.length}` }));
    const toggle = () => { if (state.openStages.has(s.id)) state.openStages.delete(s.id); else state.openStages.add(s.id); renderProject(p.id); };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    card.append(head);
    if (open) {
      const rerender = async () => { await syncStage(s, st, ctx); renderProject(p.id); };
      const startBtn = !s.start_date ? h("button", { class: "btn small ghost", type: "button", text: "התחלת השלב", on: { click: async () => {
        const patch = { start_date: today(), due_date: s.typical_days ? addDays(today(), s.typical_days) : null };
        await run(db.from("stages").update(patch).eq("id", s.id)); Object.assign(s, patch);
        toast(s.typical_days ? `תאריך יעד מוצע: ${fmt(patch.due_date)}. אפשר לשנות.` : "השלב התחיל"); rerender();
      } } }) : null;
      const openTasks = st.filter(isOpen);
      const completeBtn = openTasks.length ? h("button", { class: "btn small ghost", type: "button", text: "סימון כל השלב כהושלם", on: { click: async () => {
        await run(db.from("tasks").update({ status: "הושלם", done_at: today(), waiting_since: null }).in("id", openTasks.map(t => t.id)));
        openTasks.forEach(t => Object.assign(t, { status: "הושלם", done_at: today() }));
        rerender();
      } } }) : null;
      const deleteBtn = confirmButton("מחיקת השלב", async () => {
        await run(db.from("stages").delete().eq("id", s.id));
        toast(`השלב "${s.name}" נמחק מהפרויקט`); renderProject(p.id);
      });
      const meta = h("div", { class: "stage-meta" },
        startBtn, completeBtn, deleteBtn,
        s.start_date ? h("span", { class: "num", text: "התחיל " + fmt(s.start_date) }) : null,
        field("יעד לשלב", dateField(s.due_date, async v => { await run(db.from("stages").update({ due_date: v }).eq("id", s.id)); s.due_date = v; toast("נשמר"); }, "יעד לשלב")),
        s.typical_days ? h("span", { text: `משך טיפוסי: ${s.typical_days} ימים` }) : null,
        s.needs_approval ? h("span", { class: "pill oak", text: "נסגר באישור לקוח" }) : null,
        s.distribute_to ? h("span", { text: "נשלח ל: " + s.distribute_to }) : null);
      const add = h("input", { type: "text", placeholder: "משימה חדשה בשלב הזה", "aria-label": "משימה חדשה" });
      const addTask = async () => {
        const name = add.value.trim(); if (!name) return;
        await run(db.from("tasks").insert({ project_id: p.id, stage_id: s.id, name, position: (st.at(-1)?.position || 0) + 1 }));
        rerender();
      };
      add.addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });
      card.append(h("div", { class: "stage-body" }, meta, s.note ? h("p", { class: "small muted", text: s.note }) : null,
        h("div", { class: "tasks" }, st.map(t => taskRow(t, { onChange: rerender, onDelete: rerender }))),
        h("div", { class: "addline" }, add, h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: addTask } }))));
    }
    return card;
  }));
}

// When a change affects several plans: open an update task for each chosen plan
function changePanel(ctx) {
  const planTasks = ctx.tasks.filter(t => /תכנית|פריסות|שרטוטי/.test(t.name) && !t.name.startsWith("עדכון"));
  const desc = h("input", { type: "text", placeholder: "למשל: הזזת המקלחת בחדר הרחצה של ההורים" });
  const boxes = planTasks.map(t => ({ t, cb: h("input", { type: "checkbox" }) }));
  const body = h("div", { class: "group" },
    field("מה השתנה?", desc),
    h("p", { class: "small muted", text: "סמני את התכניות שצריך לעדכן. לכל אחת תיפתח משימת עדכון באותו שלב." }),
    h("div", { class: "group" }, boxes.map(({ t, cb }) => h("label", { class: "row" }, cb, t.name))));
  openPanel("שינוי בתכנון", body, close => [
    h("button", { class: "btn", type: "button", text: "פתיחת משימות עדכון", on: { click: async () => {
      const chosen = boxes.filter(b => b.cb.checked);
      if (!desc.value.trim() || !chosen.length) { toast("צריך לכתוב מה השתנה ולסמן לפחות תכנית אחת"); return; }
      await run(db.from("tasks").insert(chosen.map(({ t }) => ({
        project_id: ctx.p.id, stage_id: t.stage_id, position: t.position, priority: 1,
        name: `עדכון ${t.name.replace(/^תכנית /, "תכנית ")}: ${desc.value.trim()}`
      }))));
      for (const { t } of chosen) {
        const st = ctx.stages.find(s => s.id === t.stage_id);
        if (st?.done_at) await run(db.from("stages").update({ done_at: null }).eq("id", st.id));
      }
      close(); toast(`נפתחו ${chosen.length} משימות עדכון`); renderProject(ctx.p.id);
    } } })
  ]);
}

// Materials and purchases ----------------------------------------------------------
const ITEM_STATUSES = ["לבחירה", "נבחר", "הוזמן", "סופק", "הותקן"];
// Column sets per category. "calc" columns are computed, never stored.
const C = {
  room: ["room", "חדר / אזור"], supplier: ["supplier", "ספק"], qty: ["quantity", "כמות", "num"], price: ["unit_price", "מחיר ליח'", "num"],
  status: ["status", "סטטוס", "status"], link: ["link", "קישור", "link"], notes: ["notes", "הערות"], total: ["_total", "סה\"כ", "calc"],
  delivery: ["delivery_date", "אספקה", "date"]
};
const ITEM_CATEGORIES = [
  { key: "tiles", label: "ריצוף וחיפוי", cols: [C.room, ["name", "שימוש (רצפה / קיר / חיפוי)"], ["model", "מוצר / דגם"], C.supplier, ["size", "מידת אריח"], ["color", "גוון / גימור"],
    ["quantity", "מ\"ר נטו", "num"], ["waste_pct", "% פחת", "num"], ["_order", "מ\"ר להזמנה", "calc"], ["unit_price", "מחיר למ\"ר", "num"], C.total, C.status, C.notes] },
  { key: "sanitary", label: "כלים סניטריים וארונות רחצה", cols: [C.room, ["name", "פריט"], ["model", "דגם / מק\"ט"], C.supplier, ["color", "גימור / גוון"], ["size", "מידה"], C.qty, C.price, C.total, C.status, C.link, C.notes] },
  { key: "lighting", label: "גופי תאורה", cols: [C.room, ["name", "סוג הגוף"], ["model", "דגם"], C.supplier, ["color", "גוון הגוף"], ["size", "מידה / גוון אור"], C.qty, C.price, C.total, C.status, C.link, C.notes] },
  { key: "colors", label: "גוונים לקירות", cols: [C.room, ["name", "קיר / מיקום"], ["model", "קוד גוון"], ["color", "שם הגוון"], ["supplier", "חברה"], ["size", "סוג צבע / גמר"], C.notes] },
  { key: "carpentry", label: "נגרות", cols: [["model", "סימון"], C.room, ["name", "תיאור"], ["color", "חזית וגוון"], ["size", "מידות"], ["supplier", "נגר"], C.qty, C.price, C.total, C.status, C.notes] },
  { key: "furniture", label: "ריהוט", cols: [C.room, ["name", "פריט"], ["model", "דגם"], C.supplier, ["size", "מידות"], ["color", "בד / גוון"], C.qty, C.price, C.total, C.status, C.delivery, C.link, C.notes] },
  { key: "decor", label: "טקסטיל ואקססוריז", cols: [C.room, ["name", "פריט"], ["model", "דגם"], C.supplier, ["size", "מידות"], ["color", "גוון"], C.qty, C.price, C.total, C.status, C.delivery, C.link, C.notes] },
  { key: "kitchen", label: "נלווים למטבח", cols: [["name", "פריט (משטח, כיור, ברז, מכשיר)"], ["model", "דגם"], C.supplier, ["size", "מידה"], ["color", "גוון / גימור"], C.qty, C.price, C.total, C.status, C.delivery, C.link, C.notes] }
];
// Rounded up to 2 decimals; the inner round strips float noise (39 × 1.1 = 42.900000000000006)
function orderQty(x) { return x.quantity == null ? null : Math.ceil(Math.round(Number(x.quantity) * (1 + Number(x.waste_pct || 0) / 100) * 1e6) / 1e4) / 100; }
function itemTotal(x, cat) {
  const q = cat === "tiles" ? orderQty(x) : (x.quantity == null ? 1 : Number(x.quantity));
  return x.unit_price == null || q == null ? null : Math.round(q * Number(x.unit_price) * 100) / 100;
}
const calcValue = (x, f, cat) => f === "_order" ? (orderQty(x) ?? "—") : money(itemTotal(x, cat));

function itemsTab(ctx) {
  const { p, items } = ctx;
  const cat = ITEM_CATEGORIES.find(c => c.key === state.itemCat) || ITEM_CATEGORIES[0];
  const list = items.filter(x => x.category === cat.key);
  const hasPrice = cat.cols.some(c => c[0] === "_total");
  const totalEl = h("b", { class: "num" });
  const updateTotal = () => { totalEl.textContent = money(list.reduce((a, x) => a + (itemTotal(x, cat.key) || 0), 0)); };
  updateTotal();

  const row = x => {
    const calcCells = [];
    const tr = h("tr", {}, cat.cols.map(([f, , type]) => {
      if (type === "calc") { const td = h("td", { class: "num", text: calcValue(x, f, cat.key) }); calcCells.push([td, f]); return td; }
      const save = async v => {
        const patch = { [f]: v };
        if (f === "status" && v === "הוזמן" && !x.order_date) patch.order_date = today();
        await run(db.from("items").update(patch).eq("id", x.id)); Object.assign(x, patch);
        calcCells.forEach(([td, cf]) => { td.textContent = calcValue(x, cf, cat.key); }); updateTotal();
      };
      if (type === "status") return h("td", {}, select(ITEM_STATUSES, x.status, save, { "aria-label": "סטטוס" }));
      if (type === "date") return h("td", {}, dateField(x[f], v => save(v)));
      const input = h("input", { type: type === "num" ? "number" : type === "date" ? "date" : "text", step: type === "num" ? "any" : null, value: x[f] ?? "",
        "aria-label": f, on: { change: e => save(e.target.value === "" ? null : type === "num" ? Number(e.target.value) : e.target.value) } });
      if (type === "link") return h("td", { class: "linkcell" }, input, x.link ? h("a", { href: x.link, target: "_blank", rel: "noopener", text: "פתיחה" }) : null);
      return h("td", {}, input);
    }), h("td", {}, confirmButton("מחיקה", async () => { await run(db.from("items").delete().eq("id", x.id)); tr.remove(); ctx.items.splice(ctx.items.indexOf(x), 1); list.splice(list.indexOf(x), 1); updateTotal(); })));
    return tr;
  };

  const tbody = h("tbody", {}, list.map(row));
  const addRow = async () => {
    const created = await run(db.from("items").insert({ project_id: p.id, category: cat.key, position: list.length + 1, waste_pct: cat.key === "tiles" ? 10 : null }).select().single());
    ctx.items.push(created); list.push(created);
    const tr = row(created); tbody.append(tr); tr.querySelector("input")?.focus();
  };
  const counts = Object.fromEntries(ITEM_CATEGORIES.map(c => [c.key, items.filter(x => x.category === c.key).length]));

  return h("div", { class: "group" },
    h("div", { class: "filters" }, ITEM_CATEGORIES.map(c => h("button", { class: "chip" + (c.key === cat.key ? " on" : ""), type: "button", text: c.label + (counts[c.key] ? ` ${counts[c.key]}` : ""),
      on: { click: () => { state.itemCat = c.key; renderProject(p.id); } } }))),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("h3", { text: cat.label }), h("span", { class: "spacer" }),
        hasPrice ? h("span", { class: "small muted" }, "סה\"כ: ", totalEl) : null,
        h("button", { class: "btn small ghost", type: "button", text: "ייצוא לאקסל", on: { click: () => exportItems(p, items) } })),
      cat.key === "tiles" ? h("p", { class: "small muted", text: "מ\"ר להזמנה מחושב מהמ\"ר נטו ועוד אחוז הפחת (ברירת מחדל 10%, אפשר לשנות בכל שורה)." }) : null,
      h("div", { class: "tablewrap" }, h("table", { class: "items" },
        h("thead", {}, h("tr", {}, cat.cols.map(([, label]) => h("th", { text: label })), h("th", {}))), tbody)),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "הוספת שורה", on: { click: addRow } }))));
}

// One CSV for the whole project; the BOM lets Excel read Hebrew correctly
function exportItems(p, items) {
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  for (const cat of ITEM_CATEGORIES) {
    const list = items.filter(x => x.category === cat.key);
    if (!list.length) continue;
    lines.push(esc(cat.label));
    lines.push(cat.cols.map(c => esc(c[1])).join(","));
    for (const x of list) lines.push(cat.cols.map(([f, , type]) => esc(type === "calc" ? (f === "_order" ? orderQty(x) : itemTotal(x, cat.key)) : x[f])).join(","));
    lines.push("");
  }
  if (!lines.length) { toast("אין עדיין פריטים לייצוא"); return; }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${p.number || ""} ${p.name} - חומרים ורכישות.csv`.trim() });
  document.body.append(a); a.click(); a.remove();
}

function distsTab({ dists, p }) {
  return h("div", { class: "card" },
    h("p", { class: "small muted", text: p.last_sync ? `עודכן מתיקיית PDF ב-${fmt(p.last_sync)}` : "הרשימה תתעדכן מתיקיית PDF של הפרויקט פעם ביום." }),
    dists.length ? h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "תאריך" }), h("th", { text: "תיאור" }), h("th", { text: "קבצים" }))),
      h("tbody", {}, dists.map(d => h("tr", {}, h("td", { class: "num", text: fmt(d.dist_date) }), h("td", { text: d.description || d.folder_name }), h("td", { class: "num", text: d.file_count ?? "" }))))))
      : h("div", { class: "empty" }, "עוד אין מסמכים שנשלחו."));
}

function paysTab(ctx) {
  const { p } = ctx;
  const refresh = () => renderProject(p.id);
  const upd = (x, patch) => run(db.from("payments").update(patch).eq("id", x.id)).then(() => { Object.assign(x, patch); refresh(); });
  const sum = list => list.reduce((a, x) => a + Number(x.amount || 0), 0);
  const fees = ctx.pays.filter(x => x.kind !== "commission");
  const coms = ctx.pays.filter(x => x.kind === "commission");

  const totals = (list, labels) => {
    const total = sum(list), paid = sum(list.filter(x => x.paid_at));
    return h("div", { class: "totals" },
      h("div", {}, h("span", { class: "small muted", text: labels[0] }), h("b", { text: money(total) })),
      h("div", {}, h("span", { class: "small muted", text: "התקבל, לפני מע\"מ" }), h("b", { text: money(paid) })),
      h("div", {}, h("span", { class: "small muted", text: "יתרה, לפני מע\"מ" }), h("b", { text: money(total - paid) })),
      h("div", {}, h("span", { class: "small muted", text: "יתרה כולל מע\"מ" }), h("b", { text: money((total - paid) * (1 + VAT)) })));
  };
  const rowClass = x => "pay-row" + (x.paid_at ? " is-paid" : x.remind ? " is-remind" : "");
  const cells = {
    text: (x, f, ph, fallback, cls) => h("td", {}, h("input", { type: "text", class: cls || null, value: x[f] || "", placeholder: ph || "", on: { change: e => upd(x, { [f]: e.target.value || fallback || null }) } })),
    remind: x => h("td", {}, x.paid_at ? null : h("button", { type: "button", class: "remind-btn", "aria-pressed": String(!!x.remind), title: "לסמן שצריך להזכיר לשלם",
      text: x.remind ? "לתזכר ✓" : "לתזכר", on: { click: () => upd(x, { remind: !x.remind }) } })),
    amount: x => h("td", {}, h("input", { type: "number", value: x.amount ?? "", on: { change: e => upd(x, { amount: e.target.value === "" ? null : Number(e.target.value) }) } })),
    vat: x => h("td", { class: "num", text: x.amount == null ? "—" : money(Number(x.amount) * (1 + VAT)) }),
    due: x => h("td", {}, dateField(x.due_date, v => upd(x, { due_date: v }), "צפוי להיכנס")),
    paid: x => h("td", {}, h("label", { class: "row paid-cell" }, h("input", { type: "checkbox", checked: !!x.paid_at, "aria-label": "שולם", on: { change: e => upd(x, e.target.checked ? { paid_at: today(), remind: false } : { paid_at: null }) } }),
      x.paid_at ? `שולם ${fmt(x.paid_at)}` : "לא שולם")),
    del: x => h("td", {}, confirmButton("מחיקה", () => run(db.from("payments").delete().eq("id", x.id)).then(refresh)))
  };

  return h("div", { class: "group" },
    h("div", { class: "legend-row small" },
      h("span", { class: "swatch is-paid" }), "שולם",
      h("span", { class: "swatch is-remind" }), "צריך להזכיר לשלם",
      h("span", { class: "swatch" }), "עוד לא שולם"),
    h("section", { class: "card pay-section fees" },
      h("h3", { class: "pay-title", text: "שכר טרחה" }),
      totals(fees, ["שכר טרחה, לפני מע\"מ"]),
      fees.length ? h("div", { class: "tablewrap" }, h("table", { class: "pays" },
        h("thead", {}, h("tr", {}, ["שלב תשלום", "סכום לפני מע\"מ", "כולל מע\"מ", "מתי", "צפוי להיכנס", "סטטוס", "תזכורת", ""].map(t => h("th", { text: t })))),
        h("tbody", {}, fees.map(x => h("tr", { class: rowClass(x) }, cells.text(x, "name", "", "תשלום"), cells.amount(x), cells.vat(x),
          cells.text(x, "trigger_note", "למשל: בתחילת שלב הליווי"), cells.due(x), cells.paid(x), cells.remind(x), cells.del(x))))))
        : h("div", { class: "empty" }, "עוד אין שלבי תשלום. הוסיפי אותם לפי הצעת המחיר."),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "הוספת שלב תשלום", on: { click: async () => {
        await run(db.from("payments").insert({ project_id: p.id, kind: "fee", name: `תשלום ${fees.length + 1}`, position: fees.length + 1 })); refresh();
      } } }))),
    h("section", { class: "card pay-section coms" },
      h("h3", { class: "pay-title", text: "עמלות ספקים" }),
      totals(coms, ["עמלות, לפני מע\"מ"]),
      coms.length ? h("div", { class: "tablewrap" }, h("table", { class: "pays" },
        h("thead", {}, h("tr", {}, ["ספק", "מה נקנה", "סכום לפני מע\"מ", "כולל מע\"מ", "צפוי להיכנס", "סטטוס", "תזכורת", "הערות", ""].map(t => h("th", { text: t })))),
        h("tbody", {}, coms.map(x => h("tr", { class: rowClass(x) }, cells.text(x, "supplier", "שם הספק (חסר)", null, "supplier-input"), cells.text(x, "name", "ארונות, ספה, סניטריה…", "עמלה"), cells.amount(x), cells.vat(x),
          cells.due(x), cells.paid(x), cells.remind(x), cells.text(x, "trigger_note", "למשל: אחרי האספקה"), cells.del(x))))))
        : h("div", { class: "empty" }, "עוד אין עמלות ספקים בפרויקט."),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "הוספת עמלה", on: { click: async () => {
        await run(db.from("payments").insert({ project_id: p.id, kind: "commission", name: "עמלה", position: 100 + coms.length + 1 })); refresh();
      } } }))),
    h("p", { class: "small muted", text: `מע"מ מחושב לפי ${VAT * 100}%. כל תשלום עם תאריך "צפוי להיכנס" בשבוע הקרוב יופיע ב"היום והשבוע".` }));
}

function questionsTab({ questions, p }) {
  const refresh = () => renderProject(p.id);
  const q = h("input", { type: "text", placeholder: "שאלה חדשה ללקוח", "aria-label": "שאלה חדשה" });
  const add = async () => { if (!q.value.trim()) return; await run(db.from("questions").insert({ project_id: p.id, question: q.value.trim() })); refresh(); };
  q.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  const open = questions.filter(x => !x.answered_at);
  const copyOpen = () => copyText(open.map((x, i) => `${i + 1}. ${x.question}`).join("\n"));
  return h("div", { class: "card" },
    h("div", { class: "addline" }, q, h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: add } }),
      open.length ? h("button", { class: "btn small ghost", type: "button", text: "העתקת השאלות הפתוחות לוואטסאפ", on: { click: copyOpen } }) : null),
    questions.length ? h("div", { class: "tasks" }, questions.map(x => h("div", { class: "task" + (x.answered_at ? " is-done" : "") },
      h("input", { type: "checkbox", checked: !!x.answered_at, "aria-label": "נענתה", on: { change: async e => { await run(db.from("questions").update({ answered_at: e.target.checked ? today() : null }).eq("id", x.id)); refresh(); } } }),
      h("div", { class: "tname", text: x.question }),
      h("div", { class: "ctrls" }, confirmButton("מחיקה", () => run(db.from("questions").delete().eq("id", x.id)).then(refresh))),
      h("div", { class: "extra" }, h("input", { type: "text", value: x.answer || "", placeholder: "התשובה", on: { change: e => run(db.from("questions").update({ answer: e.target.value || null }).eq("id", x.id)) } })))))
      : h("div", { class: "empty" }, "אין שאלות פתוחות."));
}

function meetingsTab({ meetings, p }) {
  const refresh = () => renderProject(p.id);
  const date = dateField(today(), null, "תאריך הפגישה");
  const notes = h("textarea", { placeholder: "מה סוכם בפגישה" });
  return h("div", { class: "group" },
    h("div", { class: "card" }, h("div", { class: "form-grid" }, field("תאריך", date), field("הערות", notes, "wide")),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "שמירת פגישה", on: { click: async () => {
        if (!notes.value.trim()) return; await run(db.from("meetings").insert({ project_id: p.id, meet_date: date.value || today(), notes: notes.value.trim() })); refresh();
      } } }))),
    meetings.map(m => h("div", { class: "card" },
      h("div", { class: "row" }, h("h3", { class: "num", text: fmt(m.meet_date) }), h("span", { class: "spacer" }),
        h("button", { class: "btn small ghost", type: "button", text: "העתקת סיכום לוואטסאפ", on: { click: () => copyText(`סיכום הפגישה מ-${fmt(m.meet_date)}:\n${m.notes || ""}`) } }),
        confirmButton("מחיקה", () => run(db.from("meetings").delete().eq("id", m.id)).then(refresh))),
      h("textarea", { value: m.notes || "", on: { change: e => run(db.from("meetings").update({ notes: e.target.value }).eq("id", m.id)) } }))));
}

async function contactsTab({ pcontacts, p }) {
  const holder = h("div", { class: "card" }, h("p", { class: "muted", text: "טוען…" }));
  const all = await run(db.from("contacts").select("*").order("name"));
  const refresh = () => renderProject(p.id);
  const linked = new Set(pcontacts.map(x => x.contact_id));
  const pick = select([["", "בחירת איש קשר מהמאגר"], ...all.filter(c => !linked.has(c.id)).map(c => [String(c.id), `${c.name}${c.kind ? " · " + c.kind : ""}`])], "");
  const role = h("input", { type: "text", placeholder: "תפקיד בפרויקט (נגר, ספק מטבחים…)" });
  holder.replaceChildren(
    pcontacts.length ? h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["שם", "תפקיד", "טלפון", "מייל", ""].map(t => h("th", { text: t })))),
      h("tbody", {}, pcontacts.map(x => h("tr", {},
        h("td", { text: x.contacts?.name || "" }), h("td", { text: x.role || x.contacts?.kind || "" }),
        h("td", { class: "num", text: x.contacts?.phone || "" }), h("td", { text: x.contacts?.email || "" }),
        h("td", {}, confirmButton("הסרה מהפרויקט", () => run(db.from("project_contacts").delete().eq("id", x.id)).then(refresh))))))))
      : h("div", { class: "empty" }, "עוד לא שויכו אנשי קשר לפרויקט."),
    h("div", { class: "addline" }, pick, role, h("button", { class: "btn small", type: "button", text: "שיוך", on: { click: async () => {
      if (!pick.value) return; await run(db.from("project_contacts").insert({ project_id: p.id, contact_id: Number(pick.value), role: role.value.trim() || null })); refresh();
    } } })),
    h("p", { class: "small muted" }, "איש קשר חדש מוסיפים ב", h("a", { href: "#/contacts", text: "מאגר אנשי הקשר" }), "."));
  return holder;
}

function folderTab({ p }) {
  const path = p.folder_name ? PROJECTS_ROOT + p.folder_name : null;
  const pics = p.folder_pics || {};
  return h("div", { class: "card" },
    path ? h("div", { class: "row" }, h("code", { class: "small", text: path }), h("button", { class: "btn small ghost", type: "button", text: "העתקה", on: { click: () => copyText(path) } }))
         : h("p", { class: "muted", text: "לא הוגדרה תיקייה. אפשר להוסיף את שם התיקייה בעריכת הפרטים." }),
    h("p", { class: "small muted", text: p.last_sync ? `עודכן ב-${fmt(p.last_sync)}` : "המידע מהתיקייה יתעדכן פעם ביום." }),
    h("h3", { text: "צילומים" }),
    h("div", { class: "row" }, ["before", "during", "after"].map(k => h("span", { class: "pill" + (pics[k] ? " done" : ""), text: `${k}: ${pics[k] ?? 0}` }))),
    h("h3", { text: "מסמכים ב-docs" }),
    (p.folder_docs || []).length ? h("ul", {}, p.folder_docs.map(d => h("li", { text: d }))) : h("p", { class: "muted", text: "אין מידע עדיין." }));
}

// Today & this week -------------------------------------------------------------
async function renderToday() {
  const t = today(), week = addDays(t, 7), lastDay = addDays(t, 6);
  const [tasks, doneInWeek, projects, pays, deliveries, reminders] = await Promise.all([
    run(db.from("tasks").select("*, projects(id, name, number)").not("status", "in", "(\"הושלם\",\"לא רלוונטי\")").order("due_date", { nullsFirst: false })),
    run(db.from("tasks").select("*, projects(id, name, number)").eq("status", "הושלם").gte("due_date", t).lte("due_date", lastDay)),
    run(db.from("projects").select("id, number, name").order("number", { ascending: false, nullsFirst: false })),
    run(db.from("payments").select("*, projects(id, name, number)").is("paid_at", null).not("due_date", "is", null).lte("due_date", week).order("due_date")),
    run(db.from("items").select("*, projects(id, name, number)").in("status", ["נבחר", "הוזמן"]).not("delivery_date", "is", null).lte("delivery_date", week).order("delivery_date")),
    run(db.from("payments").select("*, projects(id, name, number)").eq("remind", true).is("paid_at", null).order("due_date", { nullsFirst: false }))
  ]);
  const payLabel = x => x.kind === "commission" ? `עמלה: ${[x.supplier, x.name].filter(Boolean).join(" · ")}` : [x.payer, x.name].filter(Boolean).join(" · ");
  const label = x => x.projects ? h("a", { href: `#/p/${x.projects.id}`, text: `${x.projects.number ? x.projects.number + " · " : ""}${x.projects.name}` }) : "משימה כללית";
  const payWhere = x => x.projects ? label(x) : "בלי פרויקט";
  const refresh = () => renderToday();
  const rows = list => h("div", { class: "card tasks" }, list.map(x => taskRow(x, { projectLabel: label(x), onChange: refresh, onDelete: refresh, rooms: false })));

  // Day by day for the coming week. Anything left open from an earlier day rolls into today.
  const carried = tasks.filter(x => x.due_date && x.due_date < t);
  const dayTasks = iso => [...tasks, ...doneInWeek].filter(x => x.due_date === iso).sort((a, b) => isDone(a) - isDone(b));
  const dayTitle = (iso, i) => i === 0 ? "היום" : i === 1 ? "מחר" : new Date(iso + "T12:00:00").toLocaleDateString("he-IL", { weekday: "long" });
  const projectOptions = [["", "כללי (בלי פרויקט)"], ...projects.map(pr => [String(pr.id), `${pr.number ? pr.number + " · " : ""}${pr.name}`])];
  const addToDay = async (iso, input, pick) => {
    const name = input.value.trim(); if (!name) { input.focus(); return; }
    const projectId = pick.value ? Number(pick.value) : null;
    let stageId = null;
    if (projectId) {
      // A project task goes into the project's current stage, so it shows on the project page too
      const stages = await run(db.from("stages").select("id, done_at").eq("project_id", projectId).order("position"));
      stageId = (stages.find(s => !s.done_at) || stages.at(-1) || {}).id ?? null;
    }
    await run(db.from("tasks").insert({ name, due_date: iso, project_id: projectId, stage_id: stageId, priority: null, position: 900 }));
    toast("נוסף ל" + (iso === t ? "היום" : fmt(iso))); refresh();
  };
  const dayCard = i => {
    const iso = addDays(t, i);
    const list = dayTasks(iso);
    const late = i === 0 ? carried : [];
    const open = list.filter(isOpen).length + late.length;
    const input = h("input", { type: "text", placeholder: "מה לעשות " + (i === 0 ? "היום" : i === 1 ? "מחר" : "ב" + dayTitle(iso, i)), "aria-label": "משימה חדשה ל" + dayTitle(iso, i) });
    const pick = select(projectOptions, "", null, { "aria-label": "פרויקט" });
    input.addEventListener("keydown", e => { if (e.key === "Enter") addToDay(iso, input, pick); });
    return h("section", { class: "day" + (i === 0 ? " is-today" : "") },
      h("h2", {}, dayTitle(iso, i), h("span", { class: "muted small num", text: fmt(iso) }),
        open ? h("span", { class: "pill" + (late.length ? " late" : ""), text: String(open) }) : null),
      late.length || list.length ? h("div", { class: "tasks" },
        late.map(x => taskRow(x, { projectLabel: h("span", {}, label(x), h("span", { class: "carry", text: ` · לא בוצע ב־${fmt(x.due_date)}` })), onChange: refresh, onDelete: refresh, rooms: false })),
        list.map(x => taskRow(x, { projectLabel: label(x), onChange: refresh, onDelete: refresh, rooms: false }))) : null,
      h("div", { class: "addline wrap" }, input, pick, h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: () => addToDay(iso, input, pick) } })));
  };
  const waiting = tasks.filter(x => WAITING.includes(x.status)).sort((a, b) => (a.waiting_since || "").localeCompare(b.waiting_since || ""));
  const section = (title, list, cls) => h("section", { class: "group" }, h("h2", {}, title, h("span", { class: "pill " + (cls || ""), text: String(list.length) })),
    list.length ? rows(list) : h("p", { class: "muted small", text: "אין." }));
  paint("today",
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "היום והשבוע" }), h("p", { class: "sub num", text: new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) }))),
    reminders.length ? h("section", { class: "group" }, h("h2", {}, "לתזכר לשלם", h("span", { class: "pill", style: "background:var(--remind-soft);color:var(--remind)", text: String(reminders.length) })),
      h("div", { class: "card tablewrap" }, h("table", { class: "pays" }, h("tbody", {}, reminders.map(x => h("tr", { class: "pay-row is-remind" },
        h("td", {}, payWhere(x)), h("td", { text: payLabel(x) }), h("td", { class: "num", text: money(x.amount) }),
        h("td", { class: "num", text: x.due_date ? fmt(x.due_date) : "" }))))))) : null,
    h("div", { class: "week-plan" }, [0, 1, 2, 3, 4, 5, 6].map(dayCard)),
    h("p", { class: "small muted", text: "משימה שלא סומנה כבוצעה עוברת להיום, עם התאריך שבו תוכננה. כדי להעביר משימה ליום אחר, משנים לה את התאריך." }),
    section("ממתין לאחרים", waiting, "wait"),
    pays.length ? h("section", { class: "group" }, h("h2", {}, "תשלומים לגבות", h("span", { class: "pill oak", text: String(pays.length) })),
      h("div", { class: "card tablewrap" }, h("table", {}, h("tbody", {}, pays.map(x => h("tr", {},
        h("td", {}, payWhere(x)), h("td", { text: payLabel(x) }), h("td", { class: "num", text: money(x.amount) }),
        h("td", { class: "num", text: fmt(x.due_date) + (x.due_date < t ? " · באיחור" : "") }))))))) : null,
    deliveries.length ? h("section", { class: "group" }, h("h2", {}, "אספקות השבוע", h("span", { class: "pill oak", text: String(deliveries.length) })),
      h("div", { class: "card tablewrap" }, h("table", {}, h("tbody", {}, deliveries.map(x => h("tr", {},
        h("td", {}, label(x)), h("td", { text: [x.name, x.model].filter(Boolean).join(" · ") }), h("td", { text: x.supplier || "" }),
        h("td", { text: x.status }), h("td", { class: "num", text: fmt(x.delivery_date) + (x.delivery_date < t ? " · באיחור" : "") }))))))) : null);
}

// General tasks (not tied to a project) -------------------------------------------
async function renderGeneral() {
  const tasks = await run(db.from("tasks").select("*").is("project_id", null).order("due_date", { nullsFirst: false }));
  const refresh = () => renderGeneral();
  const filters = ["הכול", ...CATEGORIES];
  const shown = tasks.filter(x => state.generalFilter === "הכול" || x.category === state.generalFilter);
  const open = shown.filter(isOpen), closed = shown.filter(x => !isOpen(x));
  const name = h("input", { type: "text", placeholder: "משימה חדשה", "aria-label": "משימה חדשה" });
  const cat = select(CATEGORIES, state.generalFilter !== "הכול" ? state.generalFilter : "עסק", null, { "aria-label": "קטגוריה" });
  const due = dateField("", null, "תאריך יעד");
  const add = async () => { if (!name.value.trim()) return; await run(db.from("tasks").insert({ name: name.value.trim(), category: cat.value, due_date: due.value || null })); refresh(); };
  name.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  const opts = { onChange: refresh, onDelete: refresh, rooms: false, categories: true };
  paint("general",
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "משימות כלליות" }), h("p", { class: "sub", text: "עסק, חשבונות, שיווק, אישי וילדים. בנפרד מהפרויקטים." }))),
    h("div", { class: "card" }, h("div", { class: "addline" }, name, cat, due, h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: add } }))),
    h("div", { class: "filters" }, filters.map(f => h("button", { class: "chip" + (f === state.generalFilter ? " on" : ""), type: "button", text: f, on: { click: () => { state.generalFilter = f; renderGeneral(); } } }))),
    open.length ? h("div", { class: "card tasks" }, open.map(x => taskRow(x, { ...opts, projectLabel: x.category || "" }))) : h("div", { class: "empty" }, "אין משימות פתוחות."),
    closed.length ? h("details", {}, h("summary", { class: "muted", text: `הושלמו (${closed.length})` }), h("div", { class: "card tasks" }, closed.map(x => taskRow(x, opts)))) : null);
}

// Monthly income -----------------------------------------------------------------
// Months up to the import come from "טבלת רווחים" (income_months). Payments marked paid in the system
// after that date are added on top. Payments bulk-marked paid during the import (20.10.26) are already in the table.
const LIVE_FROM = "2026-10-21";
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

async function renderIncome() {
  const now = new Date();
  const thisYear = now.getFullYear(), thisMonth = now.getMonth() + 1;
  const year = state.incomeYear || thisYear;
  const [hist, paid, open, years, projects] = await Promise.all([
    run(db.from("income_months").select("*").eq("year", year)),
    run(db.from("payments").select("*, projects(name, number)").not("paid_at", "is", null).gte("paid_at", LIVE_FROM).gte("paid_at", `${year}-01-01`).lte("paid_at", `${year}-12-31`)),
    run(db.from("payments").select("*, projects(name, number)").is("paid_at", null)),
    run(db.from("income_months").select("year")),
    run(db.from("projects").select("id, number, name").order("number", { ascending: false, nullsFirst: false }))
  ]);
  const yearList = [...new Set([...years.map(r => r.year), thisYear])].sort((a, b) => b - a);
  const who = x => x.kind === "commission" ? (x.supplier || x.payer || x.name) : (x.projects ? x.projects.name : (x.payer || x.name));
  const refresh = () => renderIncome();
  const gross = n => Number(n || 0) * (1 + VAT);
  const add = (a, b) => (a == null && !b) ? a : Number(a || 0) + Number(b || 0);
  const joinFrom = (a, list) => [a, ...list].filter(Boolean).join(" + ");

  const rows = MONTHS.map((name, i) => {
    const m = i + 1, hRow = hist.find(r => r.month === m) || {};
    const inMonth = paid.filter(x => Number(x.paid_at.slice(5, 7)) === m);
    const fees = inMonth.filter(x => x.kind !== "commission"), coms = inMonth.filter(x => x.kind === "commission");
    const feeNet = fees.reduce((a, x) => a + Number(x.amount || 0), 0), comNet = coms.reduce((a, x) => a + Number(x.amount || 0), 0);
    const expected = open.filter(x => x.due_date && x.due_date.slice(0, 7) === `${year}-${String(m).padStart(2, "0")}`);
    return {
      m, name, exp_net: expected.reduce((a, x) => a + Number(x.amount || 0), 0), exp_from: expected.map(who).join(" + "),
      fees_gross: add(hRow.fees_gross, gross(feeNet)), fees_net: add(hRow.fees_net, feeNet), fees_from: joinFrom(hRow.fees_from, fees.map(who)),
      com_gross: add(hRow.com_gross, gross(comNet)), com_net: add(hRow.com_net, comNet), com_from: joinFrom(hRow.com_from, coms.map(who)),
      misc: hRow.misc, total_gross: add(hRow.total_gross, gross(feeNet + comNet)), total_net: add(hRow.total_net, feeNet + comNet), notes: hRow.notes
    };
  });
  const sum = f => rows.reduce((a, r) => a + Number(r[f] || 0), 0);
  const cell = v => h("td", { class: "num", text: v == null || v === 0 ? "—" : money(v) });

  // Expected: unpaid payments with an expected date this month / next month
  const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  const nextY = thisMonth === 12 ? thisYear + 1 : thisYear, nextM = thisMonth === 12 ? 1 : thisMonth + 1;
  const dueIn = key => open.filter(x => x.due_date && x.due_date.slice(0, 7) === key);
  const overdue = open.filter(x => x.due_date && x.due_date.slice(0, 7) < ym(thisYear, thisMonth));
  const thisList = dueIn(ym(thisYear, thisMonth)), nextList = dueIn(ym(nextY, nextM));
  const noDate = open.filter(x => !x.due_date && x.amount);
  const expectCard = (title, list, note) => h("section", { class: "card" },
    h("div", { class: "row" }, h("h3", { text: title }), h("span", { class: "spacer" }),
      h("span", { class: "small muted" }, "נטו: ", h("b", { class: "num", text: money(list.reduce((a, x) => a + Number(x.amount || 0), 0)) }),
        " · כולל מע\"מ: ", h("b", { class: "num", text: money(gross(list.reduce((a, x) => a + Number(x.amount || 0), 0))) }))),
    note ? h("p", { class: "small muted", text: note }) : null,
    list.length ? h("div", { class: "tablewrap" }, h("table", { class: "pays" }, h("tbody", {}, list.map(x => h("tr", { class: "pay-row" + (x.remind ? " is-remind" : "") },
      h("td", { text: who(x) }), h("td", { class: "small muted", text: x.kind === "commission" ? `עמלה · ${x.name}` : `שכר טרחה · ${x.name}` }),
      h("td", { class: "num", text: money(x.amount) }), h("td", { class: "num", text: x.due_date ? fmt(x.due_date) : "" }),
      h("td", {}, x.projects ? h("a", { href: `#/p/${x.project_id}`, text: `פרויקט ${x.projects.number || ""}`.trim() }) : h("span", { class: "small muted", text: "בלי פרויקט" })),
      h("td", {}, h("label", { class: "row paid-cell" }, h("input", { type: "checkbox", "aria-label": "שולם", on: { change: async () => {
        await run(db.from("payments").update({ paid_at: today(), remind: false }).eq("id", x.id)); toast("סומן כשולם"); refresh();
      } } }), "שולם")),
      h("td", {}, confirmButton("מחיקה", async () => { await run(db.from("payments").delete().eq("id", x.id)); toast("נמחק"); refresh(); })))))))
      : h("p", { class: "muted small", text: "אין תשלומים עם תאריך צפוי בתקופה הזאת." }));

  // Add an expected payment, with or without a project
  const f = {
    project: select([["", "בלי פרויקט"], ...projects.map(pr => [String(pr.id), `${pr.number ? pr.number + " · " : ""}${pr.name}`])], "", null, { "aria-label": "פרויקט" }),
    kind: select([["fee", "שכר טרחה"], ["commission", "עמלת ספק"]], "fee", null, { "aria-label": "סוג" }),
    from: h("input", { type: "text", placeholder: "ממי (לקוח או ספק)" }),
    what: h("input", { type: "text", placeholder: "על מה (תשלום 2, ארונות…)" }),
    amount: h("input", { type: "number", placeholder: "סכום לפני מע\"מ" }),
    due: dateField("", null, "צפוי להיכנס")
  };
  const addExpected = async () => {
    const amount = f.amount.value === "" ? null : Number(f.amount.value);
    if (!f.due.value) { toast("צריך תאריך צפוי להיכנס"); return; }
    if (amount == null) { f.amount.focus(); return; }
    const isCom = f.kind.value === "commission";
    await run(db.from("payments").insert({
      project_id: f.project.value ? Number(f.project.value) : null, kind: f.kind.value, position: 200,
      name: f.what.value.trim() || (isCom ? "עמלה" : "שכר טרחה"),
      supplier: isCom ? (f.from.value.trim() || null) : null,
      payer: !isCom ? (f.from.value.trim() || null) : null,
      amount, due_date: f.due.value
    }));
    toast("התשלום הצפוי נוסף"); refresh();
  };
  const addCard = h("section", { class: "card" },
    h("h3", { text: "הוספת תשלום צפוי" }),
    h("div", { class: "addline wrap" }, f.project, f.kind, f.from, f.what, f.amount, f.due,
      h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: addExpected } })),
    h("p", { class: "small muted", text: "תשלום שמשייכים לפרויקט יופיע גם בלשונית התשלומים של הפרויקט." }));

  paint("income",
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "הכנסות" }), h("p", { class: "sub", text: "שכר טרחה ועמלות שנכנסו בכל חודש, וכמה עוד צפוי להיכנס." }))),
    h("div", { class: "filters" }, yearList.map(y => h("button", { class: "chip" + (y === year ? " on" : ""), type: "button", text: String(y),
      on: { click: () => { state.incomeYear = y; renderIncome(); } } }))),
    year === thisYear ? h("div", { class: "group" },
      overdue.length ? expectCard("באיחור (היה צפוי בחודשים קודמים)", overdue) : null,
      expectCard(`צפוי להיכנס עוד ${MONTHS[thisMonth - 1]}`, thisList),
      expectCard(`מי צפוי לשלם ב${MONTHS[nextM - 1]}`, nextList),
      noDate.length ? h("p", { class: "small muted" }, `${noDate.length} תשלומים פתוחים עם סכום בלי תאריך "צפוי להיכנס". אפשר להוסיף תאריך בלשונית התשלומים של כל פרויקט.`) : null) : null,
    addCard,
    h("section", { class: "card" },
      h("h3", { text: `${year} לפי חודשים` }),
      h("div", { class: "tablewrap" }, h("table", { class: "income" },
        h("thead", {}, h("tr", {}, ["חודש", "שכר טרחה", "שכ\"ט נטו", "ממי שכ\"ט", "עמלות", "עמלות נטו", "ממי העמלות", "שונות", "סה\"כ", "סה\"כ נטו", "עוד צפוי (נטו)", "ממי צפוי"].map(t => h("th", { text: t })))),
        h("tbody", {}, rows.map(r => h("tr", { class: year === thisYear && r.m === thisMonth ? "current-month" : null },
          h("td", {}, h("b", { text: r.name }), r.notes ? h("div", { class: "small muted", text: r.notes }) : null),
          cell(r.fees_gross), cell(r.fees_net), h("td", { class: "small from", text: r.fees_from || "" }),
          cell(r.com_gross), cell(r.com_net), h("td", { class: "small from", text: r.com_from || "" }),
          cell(r.misc), cell(r.total_gross), h("td", { class: "num" }, h("b", { text: r.total_net ? money(r.total_net) : "—" })),
          h("td", { class: "num expected", text: r.exp_net ? money(r.exp_net) : "—" }), h("td", { class: "small from", text: r.exp_from || "" })))),
        h("tfoot", {}, h("tr", {}, h("td", {}, h("b", { text: "סה\"כ שנתי" })), cell(sum("fees_gross")), cell(sum("fees_net")), h("td", {}),
          cell(sum("com_gross")), cell(sum("com_net")), h("td", {}), cell(sum("misc")), cell(sum("total_gross")), h("td", { class: "num" }, h("b", { text: money(sum("total_net")) })),
          h("td", { class: "num expected", text: money(sum("exp_net")) }), h("td", {}))))),
      h("p", { class: "small muted", text: "החודשים עד 20.10.26 נלקחו מטבלת הרווחים באקסל. מכאן והלאה, כל תשלום שמסמנים \"שולם\" בלשונית התשלומים של פרויקט נכנס לחודש שבו סומן." })));
}

// Contacts ---------------------------------------------------------------------
async function renderContacts() {
  const contacts = await run(db.from("contacts").select("*, project_contacts(projects(id, name, number))").order("name"));
  const refresh = () => renderContacts();
  const f = { name: h("input", { type: "text", placeholder: "שם" }), kind: select(CONTACT_KINDS, "קבלן"), company: h("input", { type: "text", placeholder: "חברה" }),
    phone: h("input", { type: "text", placeholder: "טלפון", inputmode: "tel" }), email: h("input", { type: "email", placeholder: "מייל" }) };
  const upd = (c, patch) => run(db.from("contacts").update(patch).eq("id", c.id));
  paint("contacts",
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "אנשי קשר" }), h("p", { class: "sub", text: "מאגר אחד לכל הפרויקטים. בכל פרויקט משייכים מי משתתף." }))),
    h("div", { class: "card" }, h("div", { class: "addline" }, f.name, f.kind, f.company, f.phone, f.email,
      h("button", { class: "btn small", type: "button", text: "הוספה", on: { click: async () => {
        if (!f.name.value.trim()) { f.name.focus(); return; }
        await run(db.from("contacts").insert({ name: f.name.value.trim(), kind: f.kind.value, company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null }));
        refresh();
      } } }))),
    contacts.length ? h("div", { class: "card tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["שם", "סוג", "חברה", "טלפון", "מייל", "פרויקטים", ""].map(t => h("th", { text: t })))),
      h("tbody", {}, contacts.map(c => h("tr", {},
        h("td", {}, h("input", { type: "text", value: c.name, on: { change: e => upd(c, { name: e.target.value || c.name }) } })),
        h("td", {}, select(CONTACT_KINDS, c.kind || "אחר", v => upd(c, { kind: v }))),
        h("td", {}, h("input", { type: "text", value: c.company || "", on: { change: e => upd(c, { company: e.target.value || null }) } })),
        h("td", {}, h("input", { type: "text", value: c.phone || "", on: { change: e => upd(c, { phone: e.target.value || null }) } })),
        h("td", {}, h("input", { type: "text", value: c.email || "", on: { change: e => upd(c, { email: e.target.value || null }) } })),
        h("td", { class: "small" }, (c.project_contacts || []).filter(x => x.projects).map((x, i) => [i ? ", " : "", h("a", { href: `#/p/${x.projects.id}`, text: x.projects.number || x.projects.name })])),
        h("td", {}, confirmButton("מחיקה", () => run(db.from("contacts").delete().eq("id", c.id)).then(refresh))))))))
      : h("div", { class: "empty" }, "עוד אין אנשי קשר."));
}

// Start --------------------------------------------------------------------------
db.auth.onAuthStateChange((_event, session) => {
  const changed = !!state.session !== !!session;
  state.session = session;
  if (changed) route();
});
db.auth.getSession().then(({ data }) => { state.session = data.session; route(); });
