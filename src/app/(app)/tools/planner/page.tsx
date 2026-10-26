import { db } from "@/db";
import { BatchPlanner } from "@/components/tools/BatchPlanner";
import { PageHeader } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd } from "@/lib/time";
import { plannerDefaults } from "@/lib/tools-data";

export const metadata = { title: "Batch planner · Tools" };

export default async function PlannerPage() {
  await requirePageCan("lead:read");
  const d = await plannerDefaults(db);
  return (
    <>
      <PageHeader eyebrow="Tools" title="Batch planner" subtitle="How many leads and consults a batch needs, and how many a week, to fill its seats before enrolment closes." />
      <BatchPlanner d={d} today={cairoYmd(new Date())} />
    </>
  );
}
