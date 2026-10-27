"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import AuthFrame from "../auth-frame";

export default function ResetForm({ token }: { token: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/email/reset-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setMessage("If an account exists for that email, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/email/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setMessage("Password changed. Sign in with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <AuthFrame>
      <h1>{token ? "Choose a new password." : "Reset your password."}</h1>
      <p className="auth-lede">{token ? "Enter a new password for your MotionWren account." : "Enter your email and we will send you a reset link."}</p>
      {token ? (
        <form className="auth-form" onSubmit={resetPassword}>
          <label className="field">
            <span>New password</span>
            <span className="field-row">
              <input type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="8 characters or more" />
              <button type="button" className="field-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
            </span>
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input type="password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-ok" role="status">{message}</p>}
          <button className="btn btn-ink btn-lg auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : "Change password"}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={requestReset}>
          <label className="field">
            <span>Email</span>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@brokerage.com" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-ok" role="status">{message}</p>}
          <button className="btn btn-ink btn-lg auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : "Send reset link"}</button>
        </form>
      )}
      <Link className="auth-forgot" href="/signin">Back to sign in</Link>
    </AuthFrame>
  );
}
