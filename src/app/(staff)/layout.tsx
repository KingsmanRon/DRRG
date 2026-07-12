import { AppHeader } from "@/components/app-header";
import { PracticeLetterhead } from "@/components/practice-letterhead";
import { requireStaffPage } from "@/lib/auth/session";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffPage();

  return (
    <div className="staffChrome">
      <AppHeader displayName={staff.displayName} />
      <div className="staffMain">{children}</div>
      <PracticeLetterhead variant="footer" />
    </div>
  );
}
