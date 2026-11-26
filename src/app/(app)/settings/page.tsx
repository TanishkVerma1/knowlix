import { PageHeader } from "@/components/shell/app-shell";
import { SettingsView } from "@/features/settings/settings-view";

export const metadata = { title: "Settings & policy" };

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings & policy" description="Course rules, AI models, your workspace key and your data." />
      <SettingsView />
    </div>
  );
}
