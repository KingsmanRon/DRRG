import Image from "next/image";
import { ShieldLockIcon } from "@/components/icons";
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
      <div className="loginShell">
        {/* Desktop: full-height visual panel only — no branding */}
        <aside className="loginImagePanel" aria-hidden="true">
          <Image
            className="loginImage"
            src="/dr-makoane-login.jpg"
            alt=""
            fill
            priority
            quality={90}
            sizes="(max-width: 900px) 1px, min(50vw, 640px)"
          />
        </aside>

        <section className="loginPanel">
          <div className="loginPanelBrand">
            <Image className="loginPanelLogo" src={logo} alt="DRG Makoane" priority />
            <PracticeLetterhead variant="full" />
          </div>

          <div className="loginPanelDivider" role="presentation" />

          <div className="loginPanelForm">
            <h1>Sign in</h1>
            <p>Sign in with your authorised staff account.</p>
            {accessDenied && (
              <div className="formErrorBanner" role="alert">
                This account is not authorised for the patient register. Use an active staff login,
                or ask an administrator to activate your profile.
              </div>
            )}
            <LoginForm />
            <p className="loginSecureNote">
              <span className="loginSecureIcon" aria-hidden="true">
                <ShieldLockIcon size={15} />
              </span>
              Secure access for authorised staff only
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
