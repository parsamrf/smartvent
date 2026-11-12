// Shared header, navigation and footer for every page, plus the login guard
// for pages marked <body data-auth="required">.
(() => {
  const demo = new URLSearchParams(location.search).has("demo");
  const page = location.pathname.split("/").pop() || "index.html";
  const loggedIn = Auth.isLoggedIn();

  if (document.body.dataset.auth === "required" && !loggedIn && !demo) {
    location.replace("login.html");
    return;
  }

  // Inline SVG favicon so there is nothing extra to host.
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0d7d6c"/>' +
    '<g fill="#fff"><circle cx="16" cy="16" r="2.6"/><path d="M16 14c-1-4 0-8 3-8 2 0 2 3 0 6z"/><path d="M18 16c4-1 8 0 8 3 0 2-3 2-6 0z"/>' +
    '<path d="M16 18c1 4 0 8-3 8-2 0-2-3 0-6z"/><path d="M14 16c-4 1-8 0-8-3 0-2 3-2 6 0z"/></g></svg>');
  document.head.appendChild(icon);

  // In demo mode, keep "?demo" on links to the pages that need a login.
  const withDemo = (href) => (demo && ["dashboard.html", "assistant.html"].includes(href) ? `${href}?demo` : href);
  const links = [
    ["index.html", "Home"],
    ...(loggedIn || demo ? [["dashboard.html", "Dashboard"], ["assistant.html", "Assistant"]] : []),
    ["references.html", "References"],
    ...(loggedIn || demo ? [] : [["login.html", "Log in"], ["register.html", "Get started", "cta"]]),
  ];

  const logo = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/>
    <g fill="#fff"><circle cx="16" cy="16" r="2.6"/><path d="M16 14c-1-4 0-8 3-8 2 0 2 3 0 6z"/><path d="M18 16c4-1 8 0 8 3 0 2-3 2-6 0z"/>
    <path d="M16 18c1 4 0 8-3 8-2 0-2-3 0-6z"/><path d="M14 16c-4 1-8 0-8-3 0-2 3-2 6 0z"/></g></svg>`;

  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main";

  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <nav class="nav" aria-label="Main">
      <a class="brand" href="index.html">${logo}<div>Smart<span>Vent</span></div></a>
      <div class="nav-links" id="nav-links">
        ${links.map(([href, label, cls]) =>
          `<a href="${withDemo(href)}" class="${href === page ? "active" : ""} ${cls || ""}"${href === page ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
        ${loggedIn ? `<span class="nav-user"></span><button id="logout-btn">Log out</button>` : ""}
      </div>
      <button class="theme-btn" type="button" id="theme-btn"></button>
      <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links">Menu</button>
    </nav>`;
  document.body.prepend(header);
  if (demo) {
    const b = document.createElement("div");
    b.className = "demo-banner";
    b.textContent = "Demo mode: simulated data, no real devices";
    header.after(b);
  }

  const userEl = header.querySelector(".nav-user");
  if (userEl) userEl.textContent = Auth.email();

  const toggle = header.querySelector(".nav-toggle");
  toggle.addEventListener("click", () => {
    const open = header.querySelector(".nav-links").classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  header.querySelector("#logout-btn")?.addEventListener("click", async () => {
    await Auth.logout();
    location.href = "login.html?loggedout=1";
  });

  // Theme toggle cycles Auto -> Light -> Dark.
  const themeBtn = header.querySelector("#theme-btn");
  const ORDER = ["auto", "light", "dark"];
  const LABEL = { auto: "Theme: follows system", light: "Theme: light", dark: "Theme: dark" };
  const paintThemeBtn = () => {
    const t = UI.getTheme();
    themeBtn.innerHTML = UI.ICON[t === "auto" ? "auto" : t === "light" ? "sun" : "moon"];
    themeBtn.title = `${LABEL[t]} (click to change)`;
    themeBtn.setAttribute("aria-label", `${LABEL[t]}. Change theme`);
  };
  themeBtn.addEventListener("click", () => {
    const next = ORDER[(ORDER.indexOf(UI.getTheme()) + 1) % ORDER.length];
    UI.setTheme(next);
    paintThemeBtn();
    UI.toast(LABEL[next], "info", 1600);
  });
  paintThemeBtn();

  // Header gets a shadow once the page scrolls.
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 4);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Soft fade-out when following an internal link.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname || UI.reduced()) return;
    e.preventDefault();
    document.body.classList.add("leaving");
    setTimeout(() => { location.href = a.href; }, 180);
  });
  // Coming back via the back/forward cache: undo the fade.
  addEventListener("pageshow", () => document.body.classList.remove("leaving"));

  const footLinks = [
    ["index.html", "Home"],
    loggedIn ? ["dashboard.html", "Dashboard"] : ["dashboard.html?demo", "Demo dashboard"],
    ...(loggedIn || demo ? [[withDemo("assistant.html"), "Device assistant"]] : []),
    ["references.html", "References"],
    ...(loggedIn ? [] : [["login.html", "Log in"]]),
  ];
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `
    <div class="inner foot-grid">
      <div class="foot-about">
        <a class="foot-brand" href="index.html">${logo}<span>Smart<b>Vent</b></span></a>
        <p>Room-by-room ventilation that runs itself: BLE sensor nodes, an ESP32-S3 gateway, AWS IoT Core and this dashboard.</p>
      </div>
      <nav aria-label="Footer">
        <p class="foot-h">Explore</p>
        <ul>${footLinks.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul>
      </nav>
      <div>
        <p class="foot-h">Project</p>
        <ul>
          <li>ECE 413/513 Final Project</li>
          <li>University of Arizona · Fall 2026</li>
          <li><a href="index.html#team">Parsa Mirfasihi, Afsah Khan &amp; Afjal Saower</a></li>
          <li class="foot-secure">${UI.ICON.lock}Served over HTTPS</li>
        </ul>
      </div>
    </div>
    <div class="inner foot-bottom">
      <span>© 2026 SmartVent team</span>
      <button type="button" class="ghost to-top">Back to top
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
    </div>`;
  document.body.appendChild(footer);
  footer.querySelector(".to-top").addEventListener("click", () => {
    scrollTo({ top: 0, behavior: UI.reduced() ? "auto" : "smooth" });
    header.querySelector(".brand").focus({ preventScroll: true });
  });

  UI.reveal();
})();
