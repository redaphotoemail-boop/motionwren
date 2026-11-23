import { redirect } from "next/navigation";

/* Gifts now live on the Customers page; this address keeps old links working. */
export default function GiftsPage() { redirect("/admin/customers"); }
