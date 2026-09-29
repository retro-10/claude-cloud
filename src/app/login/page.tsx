import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server-auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  // A cookie that is really valid (user active, password unchanged) skips the form.
  if (await getCurrentUser()) redirect("/");
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 font-display text-3xl">OrlaDent Camp CRM</h1>
      <p className="mb-6 text-sm text-muted">Sign in to continue.</p>
      <LoginForm />
    </main>
  );
}
