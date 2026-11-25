import { Suspense } from "react";
import { notFound } from "next/navigation";
import DashboardPage from "../dashboard";

const sections = new Set([
  "assets",
  "maintenance",
  "orders",
  "inspections",
  "fuel",
  "inventory",
  "purchases",
  "reports",
  "settings",
  "users",
  "audit",
]);

export default async function PanelSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <Suspense fallback={<div className="loading-screen" role="status"><span className="spinner" />Carregando painel...</div>}>
    <DashboardPage section={section} />
  </Suspense>;
}
