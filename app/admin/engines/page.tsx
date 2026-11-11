import { redirect } from "next/navigation";

/* Engines now live inside Production. */
export default function EnginesPage() { redirect("/admin/production"); }
