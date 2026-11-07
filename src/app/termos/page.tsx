import { LegalPage } from "@/components/LegalPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Termos e Condições" };

export default function Page() {
  return <LegalPage slug="termos" />;
}
