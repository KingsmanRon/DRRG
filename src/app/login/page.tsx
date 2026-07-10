import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import logo from "../../../public/logo.png";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginPanel">
        <Image className="brandLogo brandLogoLogin" src={logo} alt="Dr RG Makoane" priority />

        <h1>Sign in</h1>
        <p>Sign in with your authorised staff account.</p>
        <LoginForm />
      </section>
    </main>
  );
}
