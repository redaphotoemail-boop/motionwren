"use client";

import { useEffect, useState, type FormEvent } from "react";

const inputStyle = { width: "100%", padding: "12px", border: "1px solid #ccc", borderRadius: 8, fontSize: 16, boxSizing: "border-box" as const };
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 14 };

export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

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
    <main className="motionwren-site">
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "96px 20px", textAlign: "center" }}>
        <h1>{token ? "Choose a new password" : "Reset your password"}</h1>
        <p>{token ? "Enter a new password for your MotionWren account." : "Enter your email and we will send you a reset link."}</p>
        {token ? (
          <form onSubmit={resetPassword} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32, textAlign: "left" }}>
            <label style={labelStyle}>New password
              <span style={{ display: "flex", gap: 8 }}><input style={{ ...inputStyle, flex: 1 }} type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} style={{ padding: "0 12px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>{showPassword ? "Hide" : "Show"}</button></span>
              <small style={{ color: "#73767b" }}>Minimum 8 characters.</small>
            </label>
            <label style={labelStyle}>Confirm new password
              <input style={inputStyle} type="password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" />
            </label>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <button className="mw-button" type="submit" disabled={busy}>{busy ? "Please wait…" : "Change password"}</button>
          </form>
        ) : (
          <form onSubmit={requestReset} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32, textAlign: "left" }}>
            <label style={labelStyle}>Email
              <input style={inputStyle} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <button className="mw-button" type="submit" disabled={busy}>{busy ? "Please wait…" : "Send reset link"}</button>
          </form>
        )}
        <p style={{ marginTop: 32 }}><a href="/signin">Back to sign in</a></p>
      </div>
    </main>
  );
}
