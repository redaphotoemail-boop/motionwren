"use client";

import { useState, type FormEvent } from "react";

const inputStyle = { width: "100%", padding: "12px", border: "1px solid #ccc", borderRadius: 8, fontSize: 16, boxSizing: "border-box" as const };
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 14 };

export default function EmailAuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12, textAlign: "left" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => setMode("signin")} aria-pressed={mode === "signin"} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ccc", background: mode === "signin" ? "#000" : "#fff", color: mode === "signin" ? "#fff" : "#000", cursor: "pointer" }}>Sign in</button>
        <button type="button" onClick={() => setMode("signup")} aria-pressed={mode === "signup"} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ccc", background: mode === "signup" ? "#000" : "#fff", color: mode === "signup" ? "#fff" : "#000", cursor: "pointer" }}>Create account</button>
      </div>
      {mode === "signup" && (
        <label style={labelStyle}>Name (optional)
          <input style={inputStyle} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        </label>
      )}
      <label style={labelStyle}>Email
        <input style={inputStyle} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      </label>
      <label style={labelStyle}>Password
        <input style={inputStyle} type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="mw-button" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in with email"}</button>
    </form>
  );
}
