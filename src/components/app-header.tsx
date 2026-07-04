import Link from "next/link";
import { UserIcon } from "./icons";

export function AppHeader({ displayName }: { displayName: string }) {
  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <Link className="brand" href="/patients" aria-label="DRRG patients home">
          <span className="brandMark">DRRG</span>
          <span className="brandName">DRRG Patient Onboarding</span>
        </Link>
        <div className="accountLabel">
          <span className="accountIcon"><UserIcon /></span>
          <span>{displayName}</span>
        </div>
      </div>
    </header>
  );
}
