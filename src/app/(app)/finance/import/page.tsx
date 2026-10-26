import { db } from "@/db";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { WorkbookImport } from "@/components/finance/WorkbookImport";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/lib/app-settings";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd } from "@/lib/time";

export const metadata = { title: "Import workbook · Finance" };

export default async function ImportWorkbookPage() {
  const user = await requirePageCan("payment:write");
  const { financeModel } = await getSettings(db);
  const today = cairoYmd(new Date());
  const close = financeModel.closeDate;
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Import the cycle close workbook"
        subtitle="Load the partners' corrected payment list as the ledger, with the rules and the function table, from the Cycle Close workbook."
      />
      <FinanceNav />
      <WorkbookImport owner={can(user.role, "settings:write")} closeDate={close} defaultDate={close && close < today ? close : today} />
    </>
  );
}
