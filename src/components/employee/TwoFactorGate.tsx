import Link from "next/link";
import { Card, Icon, PageHeader } from "@/components/ui";

/** Shown instead of employee records until the person has turned on two-factor sign-in. */
export function TwoFactorGate({ title }: { title: string }) {
  return (
    <>
      <PageHeader eyebrow="Employee records" title={title} />
      <Card className="max-w-xl" title="Turn on two-factor sign-in first" icon="shield">
        <p className="text-sm text-muted">
          Contracts, pay and personal details are behind two-factor sign-in: a code from an app on your phone as well as your password. It takes two
          minutes, and then this page opens.
        </p>
        <Link href="/account#two-factor" className="btn btn-primary btn-sm mt-4">
          <Icon name="shield" size={14} /> Set up two-factor sign-in
        </Link>
      </Card>
    </>
  );
}
