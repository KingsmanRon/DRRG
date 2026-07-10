import Image from "next/image";
import Link from "next/link";
import { UserIcon } from "./icons";
import { SignOutButton } from "./sign-out-button";
import logo from "../../public/logo.png";

export function AppHeader({ displayName }: { displayName: string }) {
  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <Link className="brand" href="/patients" aria-label="Dr RG Makoane patients home">
          <Image className="brandLogo" src={logo} alt="Dr RG Makoane" priority />
        </Link>
        <nav className="appNav" aria-label="Main">
          <Link href="/patients">Patients</Link>
          <Link href="/patients/duplicates">Possible duplicates</Link>
        </nav>
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
