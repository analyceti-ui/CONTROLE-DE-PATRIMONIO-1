import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Patrimônio | Gestão de ativos",
    short_name: "Patrimônio",
    description: "Gestão de frota, computadores e equipamentos.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8f6",
    theme_color: "#193e35",
    icons: [
      {
        src: "/patrimonio.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
