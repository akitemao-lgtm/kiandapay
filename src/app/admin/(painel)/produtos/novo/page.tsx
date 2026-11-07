import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";

export const metadata = { title: "Novo produto" };

export default function NovoProdutoPage() {
  return (
    <>
      <Link href="/admin/produtos" className="text-sm text-gray-500 hover:text-gray-900">← Produtos</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Novo produto</h1>
      <ProductForm />
    </>
  );
}
