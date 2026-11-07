import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";

/** Texto simples: linhas em branco separam parágrafos; "# " no início é título. */
export async function LegalPage({ slug }: { slug: "privacidade" | "termos" }) {
  const db = createServiceClient();
  const { data } = await db.from("legal_pages").select("title, body_md, updated_at").eq("slug", slug).maybeSingle();
  if (!data) notFound();
  const blocks = data.body_md.split(/\n\s*\n/).map((b: string) => b.trim()).filter(Boolean);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{data.title}</h1>
      <div className="mt-6 space-y-4 text-gray-700">
        {blocks.length === 0 && <p className="text-gray-500">Em breve.</p>}
        {blocks.map((b: string, i: number) =>
          b.startsWith("# ") ? (
            <h2 key={i} className="pt-2 text-lg font-semibold text-gray-900">{b.slice(2)}</h2>
          ) : (
            <p key={i} className="whitespace-pre-line">{b}</p>
          ),
        )}
      </div>
    </main>
  );
}
