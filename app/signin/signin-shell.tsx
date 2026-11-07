"use client";

import { useState } from "react";
import AuthFrame, { GoogleMark } from "./auth-frame";
import EmailAuthForm from "./email-form";

export default function SignInShell({ initialMode = "signin", googleFailed = false, orderSaved = false }: { initialMode?: "signin" | "signup"; googleFailed?: boolean; orderSaved?: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const signup = mode === "signup";
  return (
    <AuthFrame>
      <div className="segmented auth-tabs" role="group" aria-label="Account">
        <button type="button" onClick={() => setMode("signin")} aria-pressed={!signup}>Sign in</button>
        <button type="button" onClick={() => setMode("signup")} aria-pressed={signup}>Create account</button>
      </div>
      <h1>{signup ? "Create your account." : "Welcome back."}</h1>
      <p className="auth-lede">{signup ? "Your listing videos, all in one place." : "Sign in to your MotionWren workspace."}</p>
      {orderSaved && !googleFailed && <p className="form-ok auth-notice" role="status">Your order is saved. It starts as soon as you&rsquo;re in.</p>}
      {googleFailed && <p className="form-error auth-notice" role="alert">Google sign-in did not finish. Try again, or use your email below.</p>}
      <a className="btn btn-white auth-google" href="/api/auth/google"><GoogleMark />Continue with Google</a>
      <p className="consent-note">By continuing, you confirm you are 18 or older and agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
      <div className="auth-or"><span>or use email</span></div>
      <EmailAuthForm mode={mode} />
    </AuthFrame>
  );
}
