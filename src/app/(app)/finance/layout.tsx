import { requirePageCan } from "@/lib/server-auth";

// Owner and finance only: the books, costs and each partner's share. Pages check again themselves.
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePageCan("finance:read");
  return <>{children}</>;
}
