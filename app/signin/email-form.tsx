"use client";

import { useState, type FormEvent } from "react";

export default function EmailAuthForm({ mode }: { mode: "signin" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(mode === "signup" ? "/api/auth/email/register" : "/api/auth/email/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { email, password, displayName: name } : { email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      window.location.href = data.redirect || "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === "signup" && (
        <label className="field">
          <span>Name <em>optional</em></span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Jordan Lee" />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@brokerage.com" />
      </label>
      <label className="field">
        <span>Password</span>
        <span className="field-row">
          <input type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={mode === "signup" ? "8 characters or more" : ""} />
          <button type="button" className="field-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
        </span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-ink btn-lg auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</button>
      {mode === "signin" && <a className="auth-forgot" href="/signin/reset">Forgot password?</a>}
    </form>
  );
}
