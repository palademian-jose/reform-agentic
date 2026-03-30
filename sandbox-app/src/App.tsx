import { FormEvent, useState } from "react";
import { signup } from "./mockApi";
import { useRepairState } from "./useRepairState";

export function App() {
  const repairState = useRepairState();
  const [screen, setScreen] = useState<"signup" | "dashboard">(
    window.location.pathname === "/dashboard" ? "dashboard" : "signup",
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Submitting...");
    setError(null);

    try {
      // Intentional bug: the backend expects `name`.
      await signup({ name: fullName, email });
      setStatus("Redirecting to dashboard...");
      window.history.pushState({}, "", "/dashboard");
      setScreen("dashboard");
    } catch (submitError) {
      console.error("signup.failed", submitError);
      setStatus("Failed");
      setError(
        submitError instanceof Error ? submitError.message : "Unknown failure",
      );
    }
  }

  const repairActive =
    repairState.run.targetSelector?.includes("signup-card") &&
    repairState.stage !== "verified";

  return (
    <main className="page">
      <section className="intro">
        <p className="eyebrow">Sandbox app</p>
        <h1>Broken signup flow for Reform to diagnose and repair</h1>
        <p>
          The bug is intentional. The browser agent should catch the failed
          signup request, patch the client payload, rebuild, and retest.
        </p>
      </section>

      {screen === "dashboard" ? (
        <section className="grid">
          <article className="card">
            <h2>Welcome to the dashboard</h2>
            <p>Your signup flow completed successfully.</p>
            <p className="statusLine">Status: {status}</p>
          </article>
          <article className="card cardMuted">
            <h2>Repair outcome</h2>
            <p>
              Reform should treat this state as a verified outcome because the
              app reached the intended user destination.
            </p>
          </article>
        </section>
      ) : (
        <section className="grid">
          <article
            className={repairActive ? "card cardRepairing" : "card"}
            data-repair-id="signup-card"
          >
            {repairActive ? (
              <div className="repairOverlay">
                <span className="repairBadge">{repairState.stage}</span>
                <p>{repairState.detail}</p>
              </div>
            ) : null}
            <h2>Create account</h2>
            <form onSubmit={handleSubmit}>
              <label>
                Full name
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Jamie Torres"
                />
              </label>
              <label>
                School email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jamie@school.edu"
                />
              </label>
              <button type="submit">Sign Up</button>
            </form>
            <p className="statusLine">Status: {status}</p>
            {error ? <p className="error">{error}</p> : null}
          </article>

          <article className="card cardMuted">
            <h2>Expected outcome</h2>
            <p>
              Clicking <strong>Sign Up</strong> should navigate the user to the
              dashboard after a successful signup request.
            </p>
            <ul>
              <li>The request payload must contain `name` and `email`.</li>
              <li>The submit state should clear after success.</li>
              <li>The UI card should show live repair state when the agent intervenes.</li>
            </ul>
            <p className="agentSummary">
              Agent note: {repairState.run.summary ?? "No patch applied yet."}
            </p>
          </article>
        </section>
      )}
    </main>
  );
}
