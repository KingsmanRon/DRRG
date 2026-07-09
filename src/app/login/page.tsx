import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginPanel">
        <BrandLogo className="loginBrandLogo" size={72} />
        <span className="loginBrandName">Dr RG Makoane</span>
        <h1>Patient onboarding</h1>
        <p>Sign in with your authorised staff account.</p>
        <LoginForm />
      </section>
    </main>
  );
}
