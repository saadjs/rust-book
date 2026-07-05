// @ts-check

/**
 * Bookmarks + "continue reading" for the interactive Rust Book.
 *
 * Pure client-side, no backend: all state lives in localStorage (per origin).
 * Injected as a standalone script via `additional-js` in book.toml, following
 * the same pattern as ferris.js. Targets mdBook's default theme markup.
 */

(function () {
  "use strict";

  /**
   * @typedef {{ key: string, url: string, title: string, ts: number }} Bookmark
   */

  var STORAGE_KEY = "rust-book:bookmarks:v1";
  var LAST_READ_KEY = "rust-book:last-read:v1";
  // Set once on the first page load of a tab-session. Its presence means this
  // tab has already "opened the book", so the cover must never auto-resume.
  var SESSION_OPENED_KEY = "rust-book:resumed-this-session";

  // --- auto-resume (Kindle-style "open to last-read page") -----------------

  /**
   * Is the requested URL the book's bare front door (site root)? Only the root
   * auto-resumes; every named page — including the intro reached directly — is
   * treated as an intentional destination and left alone.
   *
   * @returns {boolean}
   */
  function isBareRoot() {
    var path = location.pathname;
    return path === "" || path === "/" || /\/(?:index\.html)?$/.test(path);
  }

  /**
   * Redirect the cold-open of a tab to the reader's last-read page. Runs
   * synchronously at script parse time — before DOMContentLoaded and any UI
   * injection — so it needs no DOM and the cover barely flashes. Fires at most
   * once per tab-session, and only when that first load is the bare root.
   */
  (function maybeResume() {
    var alreadyOpened;
    try {
      alreadyOpened = sessionStorage.getItem(SESSION_OPENED_KEY);
      // Mark this tab as opened regardless, so a later root visit within the
      // same tab (e.g. clicking "home") shows the cover instead of bouncing.
      sessionStorage.setItem(SESSION_OPENED_KEY, "1");
    } catch (e) {
      return; // storage disabled: never redirect
    }
    if (alreadyOpened) return; // not a cold open
    if (!isBareRoot()) return; // only the front door resumes

    var last;
    try {
      var raw = localStorage.getItem(LAST_READ_KEY);
      last = raw ? JSON.parse(raw) : null;
    } catch (e) {
      return;
    }
    if (!last || !last.url) return;

    // Don't bounce if last-read *is* the cover. The root serves the first page
    // (experiment-intro); compare on its href to avoid a redirect to self.
    var target = String(last.url);
    if (/experiment-intro\.html?$/.test(target)) return;

    // replace() keeps the root out of history, so Back leaves the book cleanly.
    location.replace(target);
  })();

  // Apple SF Symbols "bookmark" glyphs (viewBox shared). The outline path has
  // an inner cutout so it renders hollow when filled; the fill path is solid.
  var ICON_VIEWBOX = "0 0 17.002 26.6895";
  var ICON_PATH_OUTLINE =
    "M1.21094 26.6602C1.74805 26.6602 2.08984 26.3574 3.03711 25.4297L8.21289 20.2637C8.27148 20.2051 8.36914 20.2051 8.42773 20.2637L13.6035 25.4297C14.5508 26.3477 14.8828 26.6602 15.4297 26.6602C16.1914 26.6602 16.6406 26.1426 16.6406 25.2637L16.6406 3.45703C16.6406 1.17188 15.4785 0 13.2129 0L3.42773 0C1.16211 0 0 1.17188 0 3.45703L0 25.2637C0 26.1426 0.449219 26.6602 1.21094 26.6602ZM2.08984 23.8086C1.9043 23.9941 1.69922 23.9453 1.69922 23.6816L1.69922 3.48633C1.69922 2.30469 2.31445 1.69922 3.50586 1.69922L13.1348 1.69922C14.3262 1.69922 14.9414 2.30469 14.9414 3.48633L14.9414 23.6816C14.9414 23.9453 14.7461 23.9941 14.5508 23.8086L8.92578 18.252C8.56445 17.9004 8.07617 17.9004 7.71484 18.252Z";
  var ICON_PATH_FILL =
    "M1.21094 26.6602C1.74805 26.6602 2.08984 26.3574 3.03711 25.4297L8.21289 20.2637C8.27148 20.2051 8.36914 20.2051 8.42773 20.2637L13.6035 25.4297C14.5508 26.3477 14.8828 26.6602 15.4297 26.6602C16.1914 26.6602 16.6406 26.1426 16.6406 25.2637L16.6406 3.45703C16.6406 1.17188 15.4785 0 13.2129 0L3.42773 0C1.16211 0 0 1.17188 0 3.45703L0 25.2637C0 26.1426 0.449219 26.6602 1.21094 26.6602Z";

  /**
   * @param {boolean} filled - solid glyph when bookmarked, hollow otherwise.
   * @returns {string}
   */
  function iconSvg(filled) {
    return (
      '<svg viewBox="' +
      ICON_VIEWBOX +
      '" aria-hidden="true" focusable="false" class="bookmark-icon' +
      (filled ? " is-filled" : "") +
      '"><path d="' +
      (filled ? ICON_PATH_FILL : ICON_PATH_OUTLINE) +
      '"/></svg>'
    );
  }

  // --- storage helpers -----------------------------------------------------

  /** @returns {Array<{key: string, url: string, title: string, ts: number}>} */
  function loadBookmarks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /** @param {Array<{key: string, url: string, title: string, ts: number}>} list */
  function saveBookmarks(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      /* quota or disabled storage: fail silently */
    }
  }

  /** @returns {{key: string, url: string, title: string, ts: number} | null} */
  function loadLastRead() {
    try {
      var raw = localStorage.getItem(LAST_READ_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // --- current page identity ----------------------------------------------

  /**
   * Identify the current page from the active sidebar link. Its href is
   * root-relative and stable regardless of the site's base path (e.g. the
   * `/rust-book/` prefix on GitHub Pages), which makes it a reliable key.
   *
   * @returns {{key: string, url: string, title: string} | null}
   */
  function currentPage() {
    var link = /** @type {HTMLAnchorElement | null} */ (
      document.querySelector(
        "#sidebar a.active, .chapter li.chapter-item.expanded > a.active, .chapter a.active"
      )
    );
    if (link) {
      var key = link.getAttribute("href") || location.pathname;
      var title = (link.textContent || document.title).trim();
      // strip a leading numbering like "1.2. " for a cleaner label
      title = title.replace(/^\s*[\d.]+\s+/, "");
      return { key: key, url: link.href, title: title };
    }
    // Fallback for pages with no active sidebar link (e.g. the title page).
    return {
      key: location.pathname.split("/").pop() || location.pathname,
      url: location.href,
      title: (document.title || "This page").trim(),
    };
  }

  /**
   * @param {Array<{key: string}>} list
   * @param {string} key
   * @returns {number}
   */
  function indexOfKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return i;
    }
    return -1;
  }

  // --- UI ------------------------------------------------------------------

  var page = currentPage();

  // The page the reader was on *before* this load. Captured once at init,
  // before recordLastRead() overwrites storage with the current page, so both
  // the dropdown's "continue reading" entry and the resume chip point at the
  // previous location rather than the page you're already on.
  /** @type {Bookmark | null} */
  var previousRead = null;

  function isBookmarked() {
    return page ? indexOfKey(loadBookmarks(), page.key) !== -1 : false;
  }

  function render() {
    var button = document.getElementById("bookmarks-button");
    var dropdown = document.getElementById("bookmarks-dropdown");
    if (!button || !dropdown) return;

    var list = loadBookmarks();
    var marked = isBookmarked();

    button.innerHTML = iconSvg(marked);
    button.setAttribute(
      "aria-label",
      marked ? "Bookmarks (this page is bookmarked)" : "Bookmarks"
    );
    button.classList.toggle("is-active", marked);

    // dropdown contents
    var html = "";

    // toggle current page
    if (page) {
      html +=
        '<button type="button" class="bm-toggle-current" data-action="toggle">' +
        iconSvg(marked) +
        "<span>" +
        (marked ? "Remove bookmark" : "Bookmark this page") +
        "</span></button>";
    }

    // continue reading
    var lastRead = previousRead;
    if (lastRead && (!page || lastRead.key !== page.key)) {
      html +=
        '<div class="bm-section-label">Continue reading</div>' +
        '<a class="bm-item bm-resume" href="' +
        escapeAttr(lastRead.url) +
        '"><span class="bm-item-title">' +
        escapeHtml(lastRead.title) +
        "</span></a>";
    }

    // saved bookmarks
    html += '<div class="bm-section-label">Bookmarks</div>';
    if (list.length === 0) {
      html += '<div class="bm-empty">No bookmarks yet.</div>';
    } else {
      // newest first
      var sorted = list.slice().sort(function (a, b) {
        return b.ts - a.ts;
      });
      for (var i = 0; i < sorted.length; i++) {
        var b = sorted[i];
        html +=
          '<div class="bm-item-row">' +
          '<a class="bm-item" href="' +
          escapeAttr(b.url) +
          '"><span class="bm-item-title">' +
          escapeHtml(b.title) +
          "</span></a>" +
          '<button type="button" class="bm-remove" data-action="remove" data-key="' +
          escapeAttr(b.key) +
          '" aria-label="Remove bookmark" title="Remove">&times;</button>' +
          "</div>";
      }
    }

    dropdown.innerHTML = html;
  }

  /** @type {Record<string, string>} */
  var HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  /**
   * @param {string} s
   * @returns {string}
   */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return HTML_ESCAPES[c] || c;
    });
  }

  /**
   * @param {string} s
   * @returns {string}
   */
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function toggleCurrent() {
    if (!page) return;
    var list = loadBookmarks();
    var idx = indexOfKey(list, page.key);
    if (idx === -1) {
      list.push({ key: page.key, url: page.url, title: page.title, ts: Date.now() });
    } else {
      list.splice(idx, 1);
    }
    saveBookmarks(list);
    render();
  }

  /** @param {string} key */
  function removeKey(key) {
    var list = loadBookmarks();
    var idx = indexOfKey(list, key);
    if (idx !== -1) {
      list.splice(idx, 1);
      saveBookmarks(list);
      render();
    }
  }

  function openDropdown() {
    var dropdown = document.getElementById("bookmarks-dropdown");
    if (dropdown) dropdown.classList.add("open");
  }
  function closeDropdown() {
    var dropdown = document.getElementById("bookmarks-dropdown");
    if (dropdown) dropdown.classList.remove("open");
  }
  function toggleDropdown() {
    var dropdown = document.getElementById("bookmarks-dropdown");
    if (!dropdown) return;
    if (dropdown.classList.contains("open")) closeDropdown();
    else {
      render();
      openDropdown();
    }
  }

  function injectButton() {
    var container =
      document.querySelector(".menu-bar .right-buttons") ||
      document.querySelector(".right-buttons") ||
      document.querySelector(".menu-bar .left-buttons") ||
      document.querySelector(".left-buttons") ||
      document.querySelector(".menu-bar");
    if (!container) return;

    var wrapper = document.createElement("div");
    wrapper.className = "bookmarks-wrapper";

    var button = document.createElement("button");
    button.id = "bookmarks-button";
    button.className = "icon-button";
    button.type = "button";
    button.setAttribute("aria-label", "Bookmarks");
    button.setAttribute("aria-haspopup", "true");

    var dropdown = document.createElement("div");
    dropdown.id = "bookmarks-dropdown";

    wrapper.appendChild(button);
    wrapper.appendChild(dropdown);

    // Prepend so it sits at the leading edge of the right-side buttons.
    if (container.classList.contains("right-buttons")) {
      container.insertBefore(wrapper, container.firstChild);
    } else {
      container.appendChild(wrapper);
    }

    button.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown();
    });

    dropdown.addEventListener("click", function (e) {
      var target = /** @type {HTMLElement} */ (e.target);
      var actionEl = target.closest("[data-action]");
      if (!actionEl) return; // let plain links navigate
      e.preventDefault();
      e.stopPropagation();
      var action = actionEl.getAttribute("data-action");
      if (action === "toggle") toggleCurrent();
      else if (action === "remove") removeKey(actionEl.getAttribute("data-key") || "");
    });

    document.addEventListener("click", function (e) {
      if (!wrapper.contains(/** @type {Node} */ (e.target))) closeDropdown();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDropdown();
    });
  }

  function recordLastRead() {
    if (!page) return;
    // Never let the bare front door overwrite a real reading position: if the
    // resume redirect was suppressed (e.g. not a cold open) and we're sitting
    // on the root, recording it would clobber last-read and poison future
    // resumes. Named pages (incl. experiment-intro reached directly) still record.
    if (isBareRoot()) return;
    try {
      localStorage.setItem(
        LAST_READ_KEY,
        JSON.stringify({
          key: page.key,
          url: page.url,
          title: page.title,
          ts: Date.now(),
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function init() {
    // Read last-read *before* overwriting it with the current page, so the
    // chip/dropdown can offer the previous location.
    previousRead = loadLastRead();
    injectButton();
    render();
    recordLastRead();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
