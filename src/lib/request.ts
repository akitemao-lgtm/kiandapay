import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || h.get("x-real-ip") || "";
  return {
    ip: isIP(candidate) ? candidate : null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}
