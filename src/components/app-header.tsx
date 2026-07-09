import Image from "next/image";
import Link from "next/link";
import { UserIcon } from "./icons";
import { SignOutButton } from "./sign-out-button";
import logo from "../../public/logo.png";

export function AppHeader({ displayName }: { displayName: string }) {
  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <Link className="brand" href="/patients" aria-label="DRRG patients home">
          <Image className="brandLogo" src={logo} alt="DRRG logo" priority width={48} height={48} />
          <span className="brandName">DRRG Patient Onboarding</span>
        </Link>
        <div className="accountArea">
          <div className="accountLabel">
            <span className="accountIcon"><UserIcon /></span>
            <span>{displayName}</span>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
