import Link from "next/link";

export function LegalFooter({ siteName, supportPhone }: { siteName?: string; supportPhone?: string | null }) {
  return (
    <footer className="space-y-1 pt-4 text-center text-xs text-gray-500">
      {supportPhone && <p>Dúvidas? Fale connosco: {supportPhone}</p>}
      <p>
        <Link href="/privacidade" className="underline">Privacidade</Link>
        {" · "}
        <Link href="/termos" className="underline">Termos</Link>
        {siteName && <> · {siteName}</>}
      </p>
    </footer>
  );
}
