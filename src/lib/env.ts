function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variável de ambiente em falta: ${name}`);
  return value;
}

// Referências literais para o Next.js conseguir injectar as NEXT_PUBLIC_* no bundle do browser.
export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
