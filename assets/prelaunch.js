// Slypway pre-launch site - shared client helpers.
// Theme persistence, header wiring, and small utilities used by every page.
// No build step: this file is loaded with a plain <script> tag.

(function () {
  "use strict";

  function setTheme(mode) {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem("sw-theme", mode);
    } catch (err) {
      /* storage unavailable, theme just will not persist */
    }
  }

  function initThemeToggle() {
    var buttons = document.querySelectorAll("[data-theme-button]");
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        setTheme(button.getAttribute("data-theme-button"));
      });
    });
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function formatPhone(raw) {
    var digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length < 4) return digits;
    if (digits.length < 7) {
      return "(" + digits.slice(0, 3) + ") " + digits.slice(3);
    }
    return (
      "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6)
    );
  }

  function phoneDigits(formatted) {
    return (formatted || "").replace(/\D/g, "");
  }

  function readSignup() {
    try {
      return JSON.parse(sessionStorage.getItem("sw-signup") || "{}");
    } catch (err) {
      return {};
    }
  }

  function writeSignup(patch) {
    try {
      var current = readSignup();
      sessionStorage.setItem(
        "sw-signup",
        JSON.stringify(Object.assign({}, current, patch))
      );
    } catch (err) {
      /* sessionStorage unavailable, flow falls back to re-entering fields */
    }
  }

  async function postJSON(url, body) {
    var response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    if (!response.ok) {
      var message =
        (data && data.error) || "Something went wrong. Please try again.";
      var error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  window.SwPrelaunch = {
    setTheme: setTheme,
    initThemeToggle: initThemeToggle,
    prefersReducedMotion: prefersReducedMotion,
    formatPhone: formatPhone,
    phoneDigits: phoneDigits,
    readSignup: readSignup,
    writeSignup: writeSignup,
    postJSON: postJSON,
  };

  document.addEventListener("DOMContentLoaded", initThemeToggle);
})();
