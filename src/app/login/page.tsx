import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 font-display text-3xl">OrlaDent Camp CRM</h1>
      <p className="mb-6 text-sm text-muted">Sign in to continue.</p>
      <LoginForm />
    </main>
  );
}
