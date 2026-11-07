import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Leitura de PDFs no servidor: módulos nativos/grandes ficam fora do bundle.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/pedido/[token]/comprovativo": ["./node_modules/pdfjs-dist/standard_fonts/**"],
    "/admin/**": ["./node_modules/pdfjs-dist/standard_fonts/**"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // O link do pedido é secreto: não o passar a outros sites nem indexar.
        source: "/pedido/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
