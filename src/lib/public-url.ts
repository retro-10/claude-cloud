import "server-only";
import { headers } from "next/headers";

/** The address people outside reach the app at: APP_URL, else https://DOMAIN, else this request's host. */
export async function publicBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.DOMAIN) return `https://${process.env.DOMAIN}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
