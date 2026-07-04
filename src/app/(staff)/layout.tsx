import { AppHeader } from "@/components/app-header";
import { requireStaffPage } from "@/lib/auth/session";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffPage();

  return (
    <>
      <AppHeader displayName={staff.displayName} />
      {children}
    </>
  );
}
