import ResetForm from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams?: Promise<{ token?: string }> }) {
  const params = (await searchParams) || {};
  return <ResetForm token={typeof params.token === "string" && params.token ? params.token : null} />;
}
