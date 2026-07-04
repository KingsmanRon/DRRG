import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginPanel">
        <span className="brandMark">DRRG</span>
        <h1>Patient onboarding</h1>
        <p>Sign in with your authorised staff account.</p>
        <LoginForm />
      </section>
    </main>
  );
}
