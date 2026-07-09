import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { UserIcon } from "./icons";
import { SignOutButton } from "./sign-out-button";

export function AppHeader({ displayName }: { displayName: string }) {
  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <Link className="brand" href="/patients" aria-label="Dr RG Makoane patients home">
          <BrandLogo className="brandLogo" size={44} />
          <span className="brandName">Dr RG Makoane · Patient Onboarding</span>
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
