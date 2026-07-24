/**
 * Soft login gate for the static site.
 *
 * IMPORTANT LIMITATION: this is client-side only — GitHub Pages has no server,
 * so this gate deters casual visitors but does not protect the data. The repo
 * and data/portfolio.db stay publicly fetchable, and anyone can bypass this in
 * dev tools. Replace with real server-side auth (e.g. Cloudflare Access) if the
 * data ever needs actual protection.
 *
 * Credentials are checked as SHA-256 hashes so the plaintext isn't in source.
 */
"use strict";

const Auth = {
  USERNAME_HASH: "59405314053222d46e63a405db9f44164a0e85eb2cd332f255faabe1668d3bdd",
  PASSWORD_HASH: "fd1be9166488f228aab188a30764ab1d5a67551e544b6b91d73e9d1dab11bc30",
  SESSION_KEY: "vcf-portfolio-auth",

  async sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  isLoggedIn() {
    return sessionStorage.getItem(this.SESSION_KEY) === this.PASSWORD_HASH;
  },

  async login(username, password) {
    const [userHash, passHash] = await Promise.all([
      this.sha256(username.trim().toLowerCase()),
      this.sha256(password),
    ]);
    if (userHash === this.USERNAME_HASH && passHash === this.PASSWORD_HASH) {
      sessionStorage.setItem(this.SESSION_KEY, passHash);
      return true;
    }
    return false;
  },

  logout() {
    sessionStorage.removeItem(this.SESSION_KEY);
    location.reload();
  },

  /** Hide the app behind the login overlay until credentials pass. */
  init(onSuccess) {
    const overlay = document.getElementById("login-overlay");
    if (this.isLoggedIn()) {
      overlay.classList.add("hidden");
      onSuccess();
      return;
    }
    document.body.classList.add("locked");
    const form = document.getElementById("login-form");
    const error = document.getElementById("login-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ok = await this.login(
        document.getElementById("login-username").value,
        document.getElementById("login-password").value,
      );
      if (ok) {
        overlay.classList.add("hidden");
        document.body.classList.remove("locked");
        onSuccess();
      } else {
        error.textContent = "Incorrect username or password.";
        document.getElementById("login-password").value = "";
        document.getElementById("login-password").focus();
      }
    });
  },
};
