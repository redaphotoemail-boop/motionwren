import { redirect } from "next/navigation";

/* Spend now lives on the Finance page; this address keeps old links working. */
export default function ReplicatesPage() { redirect("/admin/finance"); }
