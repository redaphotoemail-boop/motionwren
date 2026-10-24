import StudioClient from "./StudioClient";
import { requireOwner } from "../owner-auth";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  await requireOwner("/studio");
  return <StudioClient />;
}
