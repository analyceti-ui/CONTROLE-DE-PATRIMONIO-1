import { notFound } from "next/navigation";
import DashboardPage from "../../dashboard";

const topics = new Set(["account", "notifications", "equipment", "organization", "backup"]);

export default async function SettingsTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  if (!topics.has(topic)) notFound();
  return <DashboardPage section={`settings-${topic}`} />;
}
