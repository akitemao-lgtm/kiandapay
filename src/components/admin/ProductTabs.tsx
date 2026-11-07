import Link from "next/link";

export function ProductTabs({ id, active }: { id: string; active: "produto" | "checkout" | "meta" | "webhooks" }) {
  const tabs = [
    { key: "produto", label: "Produto", href: `/admin/produtos/${id}` },
    { key: "checkout", label: "Checkout", href: `/admin/produtos/${id}/checkout` },
    { key: "meta", label: "Meta", href: `/admin/produtos/${id}/meta` },
    { key: "webhooks", label: "Webhooks", href: `/admin/produtos/${id}/webhooks` },
  ];
  return (
    <div className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
            t.key === active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
