"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (!response.ok) {
        setError("The email/practice number or password is incorrect.");
        return;
      }
      router.replace("/patients");
      router.refresh();
    } catch {
      setError("The service is not configured. Contact the system administrator.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="formErrorBanner" role="alert">{error}</div>}
      <div className="formField">
        <label htmlFor="identifier">Email or practice number</label>
        <input id="identifier" type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
      </div>
      <div className="formField">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </div>
      <button className="button buttonPrimary" type="submit" disabled={submitting}>
        {submitting ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
