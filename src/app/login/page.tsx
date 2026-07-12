import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { PracticeLetterhead } from "@/components/practice-letterhead";
import logo from "../../../public/logo.png";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const accessDenied = params.error === "access";

  return (
    <main className="loginPage">
      <section className="loginPanel">
        <Image className="brandLogo brandLogoLogin" src={logo} alt="Dr RG Makoane" priority />
        <PracticeLetterhead variant="full" />

        <h1>Sign in</h1>
        <p>Sign in with your authorised staff account.</p>
        {accessDenied && (
          <div className="formErrorBanner" role="alert">
            This account is not authorised for the patient register. Use an active staff login,
            or ask an administrator to activate your profile.
          </div>
        )}
        <LoginForm />
      </section>
    </main>
  );
}
