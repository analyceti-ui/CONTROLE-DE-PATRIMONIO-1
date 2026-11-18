import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Patrimônio | Gestão de ativos",
  description: "Gestão de frota, computadores e equipamentos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
