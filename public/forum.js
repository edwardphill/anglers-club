// The forum's posting, reporting and admin buttons. The pages read fine without this; it only adds the forms.
// A name is saved on this device the same way as in the Fly AI app (localStorage "nac-auth", a session from /api/auth).
(function () {
  "use strict";
  var KEY = "nac-auth";
  var me = { admin: false, own: { threads: [], posts: [] } };

  function auth() { try { var a = JSON.parse(localStorage.getItem(KEY) || "null"); return a && a.token ? a : null; } catch (e) { return null; } }
  function keep(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function drop() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function call(url, method, body) {
    var a = auth(), headers = { "Content-Type": "application/json" };
    if (a) headers.Authorization = "Bearer " + a.token;
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { drop(); renderWho(); }
        if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
        return j;
      });
    });
  }
  function enter(name) {
    return call("/api/auth", "POST", { type: "guest", name: name }).then(function (j) { keep({ token: j.token, user: j.user }); renderWho(); return j; });
  }

  /* ---------- who is posting ---------- */
  var who;
  function renderWho() {
    if (!who) return;
    var a = auth();
    who.textContent = "";
    if (a && a.user && a.user.name) {
      var change = el("button", { type: "button", text: "Change name" });
      change.onclick = function () {
        var v = window.prompt("Your name", a.user.name);
        if (!v || !v.trim()) return;
        call("/api/auth", "POST", { type: "rename", name: v }).then(function (j) { a.user = j.user; keep(a); renderWho(); }).catch(function (e) { window.alert(e.message); });
      };
      who.appendChild(document.createTextNode("Posting as "));
      who.appendChild(el("b", { text: a.user.name }));
      who.appendChild(document.createTextNode(" · "));
      who.appendChild(change);
    } else {
      who.appendChild(document.createTextNode("Add a name to post, reply or report. "));
    }
  }

  /* ---------- forms ---------- */
  function field(label, node) { return el("label", {}, [label, node]); }
  function form(kind, mount) {
    var msg = el("div", { "class": "fx-msg", role: "status" });
    var body = el("textarea", { rows: kind === "thread" ? "7" : "4", maxlength: kind === "thread" ? "6000" : "4000", required: "" });
    var name = el("input", { type: "text", maxlength: "30", autocomplete: "nickname", placeholder: "Your name" });
    var trap = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    var btn = el("button", { type: "submit", "class": "cta", text: kind === "thread" ? "Post thread" : "Post reply" });
    var parts = [];
    var title, cat;
    if (kind === "thread") {
      cat = el("select", { required: "" });
      cat.appendChild(el("option", { value: "", text: "Choose a category" }));
      var list = []; try { list = JSON.parse(mount.getAttribute("data-cats") || "[]"); } catch (e) {}
      list.forEach(function (c) { var o = el("option", { value: c[0], text: c[1] }); if (c[0] === mount.getAttribute("data-cat")) o.selected = true; cat.appendChild(o); });
      title = el("input", { type: "text", maxlength: "120", required: "", placeholder: "What's your question or topic?" });
      parts.push(field("Category", cat), field("Title", title));
    }
    parts.push(field(kind === "thread" ? "Your post" : "Your reply", body));
    var nameRow = field("Your name", name);
    if (!auth()) parts.push(nameRow);
    parts.push(el("div", { "class": "hp", "aria-hidden": "true" }, [field("Leave this empty", trap)]), msg, btn);
    var f = el("form", { "class": "fx-form" }, parts);
    f.onsubmit = function (ev) {
      ev.preventDefault();
      msg.textContent = "";
      btn.disabled = true;
      var ready = auth() ? Promise.resolve() : (name.value.trim() ? enter(name.value) : Promise.reject(new Error("Add your name first.")));
      ready.then(function () {
        var payload = kind === "thread"
          ? { op: "thread", category: cat.value, title: title.value, body: body.value, website: trap.value }
          : { op: "reply", thread: mount.getAttribute("data-thread"), body: body.value, website: trap.value };
        return call("/api/forum", "POST", payload);
      }).then(function (j) {
        // The page is cached for a few seconds; the extra query makes the new post show at once.
        var u = String(j.url || "/forum"), at = u.indexOf("#"), hash = at < 0 ? "" : u.slice(at), path = at < 0 ? u : u.slice(0, at);
        location.href = path + (path.indexOf("?") < 0 ? "?" : "&") + "n=" + Date.now() + hash;
      }).catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
    };
    mount.appendChild(f);
  }

  /* ---------- report, remove, admin ---------- */
  function post(body) { return call("/api/forum", "POST", body); }
  function done(btn, text) { btn.textContent = text; btn.disabled = true; }
  function actions() {
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("button[data-report],button[data-own],button[data-act]");
      if (!b) return;
      var id, kind;
      if (b.hasAttribute("data-act")) { var box = b.closest("[data-mod]"); id = box.getAttribute("data-id"); kind = box.getAttribute("data-mod"); }
      else { id = b.getAttribute("data-id"); kind = b.getAttribute("data-report") || b.getAttribute("data-own"); }
      if (b.hasAttribute("data-report")) {
        if (!auth()) { window.scrollTo(0, 0); window.alert("Add a name first (at the top of the page), then report it."); return; }
        if (!window.confirm("Report this post to the moderators?")) return;
        post({ op: "report", kind: kind, id: id, reason: "" }).then(function (j) { done(b, j.hidden ? "Reported and hidden" : "Reported"); }).catch(function (e) { window.alert(e.message); });
      } else if (b.hasAttribute("data-own")) {
        if (!window.confirm("Remove your post?")) return;
        post({ op: "remove", kind: kind, id: id }).then(function () { location.reload(); }).catch(function (e) { window.alert(e.message); });
      } else {
        var act = b.getAttribute("data-act");
        if (act === "delete" && !window.confirm("Delete this for good?")) return;
        post({ op: "mod", kind: kind, id: id, action: act }).then(function () {
          if (kind === "thread" && act === "delete") location.href = "/forum"; else location.reload();
        }).catch(function (e) { window.alert(e.message); });
      }
    });
  }
  function reveal() {
    var own = {};
    me.own.threads.concat(me.own.posts).forEach(function (id) { own[id] = true; });
    [].forEach.call(document.querySelectorAll("button[data-own]"), function (b) { if (own[b.getAttribute("data-id")] || me.admin) b.hidden = false; });
    if (me.admin) {
      [].forEach.call(document.querySelectorAll("[data-mod]"), function (s) { s.hidden = false; });
      var panel = document.getElementById("fx-mod");
      if (panel) {
        call("/api/forum?op=reported", "GET").then(function (j) {
          var list = document.getElementById("fx-mod-list");
          var rows = [].concat(j.threads.map(function (t) { return { kind: "thread", id: t.id, text: t.title + " — " + t.body, by: t.by, hidden: t.hidden, reports: t.reports, author: t.author }; }),
            j.posts.map(function (p) { return { kind: "post", id: p.id, text: p.body, by: p.by, hidden: p.hidden, reports: p.reports, author: p.author }; }));
          if (!rows.length) { list.textContent = "Nothing hidden or reported."; panel.hidden = false; return; }
          var ul = el("ul");
          rows.forEach(function (r) {
            var li = el("li", {}, [el("b", { text: r.author + ": " }), r.text.slice(0, 160), " ", el("span", { "class": "muted", text: "(" + r.reports + " reports" + (r.hidden ? ", hidden" + (r.by ? " by " + r.by : "") : "") + ") " })]);
            var box = el("span", { "data-mod": r.kind, "data-id": r.id }, [
              el("button", { type: "button", "data-act": r.hidden ? "unhide" : "hide", text: r.hidden ? "Restore" : "Hide" }), " ",
              el("button", { type: "button", "data-act": "delete", text: "Delete" })]);
            li.appendChild(box); ul.appendChild(li);
          });
          list.appendChild(ul); panel.hidden = false;
        }).catch(function () {});
      }
    }
  }

  function start() {
    var main = document.querySelector("main");
    if (!main) return;
    if (!document.querySelector("[data-fx]") && !document.querySelector("[data-report]")) return;
    who = el("div", { "class": "fx-who" });
    main.insertBefore(who, main.firstChild);
    renderWho();
    [].forEach.call(document.querySelectorAll("[data-fx]"), function (m) { m.textContent = ""; form(m.getAttribute("data-fx"), m); });
    actions();
    if (auth()) call("/api/forum?op=me", "GET").then(function (j) { me = j; reveal(); }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
