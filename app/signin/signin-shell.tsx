"use client";

import { useState } from "react";
import EmailAuthForm from "./email-form";

export default function SignInShell() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "96px 20px", textAlign: "center" }}>
      <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
      <p>{mode === "signup" ? "Create an account to start your MotionWren workspace." : "Sign in to your MotionWren workspace."}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32 }}>
        <a className="mw-button" href="/api/auth/google">Continue with Google</a>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#73767b", fontSize: 12 }}><span style={{ flex: 1, borderTop: "1px solid #ddd" }} /><span>or continue with email</span><span style={{ flex: 1, borderTop: "1px solid #ddd" }} /></div>
        <EmailAuthForm mode={mode} onModeChange={setMode} />
      </div>
      <p style={{ marginTop: 32 }}><a href="/">Back to MotionWren</a></p>
    </div>
  );
}
