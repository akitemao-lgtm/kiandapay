import { LegalPage } from "@/components/LegalPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de Privacidade" };

export default function Page() {
  return <LegalPage slug="privacidade" />;
}
