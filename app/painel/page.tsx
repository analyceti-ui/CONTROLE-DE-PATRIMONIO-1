import { Suspense } from "react";
import DashboardPage from "./dashboard";

export default function PanelOverviewPage() {
  return <Suspense fallback={<div className="loading-screen" role="status"><span className="spinner" />Carregando painel...</div>}>
    <DashboardPage section="overview" />
  </Suspense>;
}
