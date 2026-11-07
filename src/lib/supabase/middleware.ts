import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

const LOGIN = "/admin/login";
const MFA = "/admin/mfa";
const HOME = "/admin";
const PUBLIC = [LOGIN, "/admin/registo"];

/**
 * Renova a sessão e protege /admin:
 * sem sessão → login (ou registo); 2FA ativada mas por confirmar → /admin/mfa.
 * O estado da conta (pendente, ativa, suspensa) é verificado no layout do
 * painel e em cada server action (requireAdmin) e, por fim, pelo RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user) {
    return PUBLIC.includes(path) ? response : redirectTo(LOGIN);
  }

  // Quem ativou a 2FA tem de a usar. O dono da plataforma (2FA obrigatória
  // mesmo sem a ter ativado) é tratado no requireAdmin.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const pendingMfa = aal?.currentLevel !== "aal2" && aal?.nextLevel === "aal2";

  if (pendingMfa && path !== MFA) return redirectTo(MFA);
  if (PUBLIC.includes(path)) return redirectTo(HOME);
  if (aal?.currentLevel === "aal2" && path === MFA) return redirectTo(HOME);

  return response;
}
