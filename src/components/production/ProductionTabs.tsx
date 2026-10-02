import { Tabs } from "@/components/ui";
import { can, type Role } from "@/lib/rbac";

/** The studio's sections; designers only have their cases. */
export function ProductionTabs({ role, current }: { role: Role; current: string }) {
  const money = can(role, "finance:read");
  const manage = can(role, "production:manage");
  const items = [
    { href: "/production", label: "Cases" },
    ...(manage || money ? [{ href: "/production/clients", label: "Clients" }] : []),
    ...(money ? [{ href: "/production/invoices", label: "Invoices" }] : []),
    ...(manage || money ? [{ href: "/production/prices", label: "Price list" }] : []),
    ...(manage || money ? [{ href: "/production/designers", label: "Designers" }] : []),
    ...(manage ? [{ href: "/production/quote", label: "Quote" }] : []),
  ];
  return items.length > 1 ? <Tabs items={items} current={current} /> : null;
}
