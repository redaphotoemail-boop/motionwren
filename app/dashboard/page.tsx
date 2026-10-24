import DashboardClient from "./DashboardClient";
import { requireOwner } from "../owner-auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireOwner("/dashboard");
  return <DashboardClient />;
}
