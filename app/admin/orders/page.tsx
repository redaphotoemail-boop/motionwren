"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead, StatusPill, ago, cents, money, statusGroup } from "../ui";
import { videoCosts } from "../../cost-model";

type Order = Record<string, string | number | null>;
const placed = (value: number) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
/* An order's cost lines from its video: engine, music, editing (see app/cost-model.ts). */
function orderCosts(order: Order) {
  if (order.productionCostCents === null || order.productionCostCents === undefined) return null;
  return videoCosts({ kind: String(order.jobKind || ""), status: String(order.jobStatus || ""), costCents: Number(order.productionCostCents), duration: Number(order.jobDuration || 0) });
}
type StatusFilter = "all" | "draft" | "production" | "failed" | "completed";
const statusFilters: Array<[StatusFilter, string]> = [["all", "All"], ["draft", "Saved"], ["production", "In production"], ["completed", "Ready"], ["failed", "Needs attention"]];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [productFilter, setProductFilter] = useState("all");
  const [customer, setCustomer] = useState("");
  const [clearing, setClearing] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");

  async function load(customerEmail: string) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/overview${customerEmail ? `?customer=${encodeURIComponent(customerEmail)}` : ""}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Orders could not be loaded.");
      setOrders(result.recentProjects || []);
      setTotal(Number(result.filteredProjectTotal ?? result.metrics?.projects?.total ?? 0));
    } catch (err) { setError(err instanceof Error ? err.message : "Orders could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      const email = params.get("customer") || "";
      const status = params.get("status") as StatusFilter | null;
      if (status && statusFilters.some(([key]) => key === status)) setStatusFilter(status);
      setCustomer(email);
      return load(email);
    });
  }, []);

  function setCustomerFilter(email: string) {
    setCustomer(email);
    const url = new URL(window.location.href);
    if (email) url.searchParams.set("customer", email); else url.searchParams.delete("customer");
    window.history.replaceState(null, "", url.toString());
    void load(email);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/admin/overview?offset=${orders.length}${customer ? `&customer=${encodeURIComponent(customer)}` : ""}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "More orders could not be loaded.");
      setOrders((items) => [...items, ...(result.recentProjects || [])]);
    } catch (err) { setError(err instanceof Error ? err.message : "More orders could not be loaded."); }
    finally { setLoadingMore(false); }
  }

  async function clearTestRows(only?: "failed") {
    if (!window.confirm(only === "failed" ? "Delete all of your own failed projects? Saved drafts and real client orders are untouched. This cannot be undone." : "Delete all of your own draft and failed test projects? Real client orders are untouched. This cannot be undone.")) return;
    setClearing(true); setCleanupMessage("");
    try {
      const response = await fetch(`/api/admin/cleanup-tests${only ? `?only=${only}` : ""}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Test rows could not be cleared.");
      setCleanupMessage(`Cleared ${result.deletedProjects} test project${result.deletedProjects === 1 ? "" : "s"} and ${result.deletedAssets} stored file${result.deletedAssets === 1 ? "" : "s"}.`);
      await load(customer);
    } catch (err) { setCleanupMessage(err instanceof Error ? err.message : "Test rows could not be cleared."); }
    finally { setClearing(false); }
  }

  const products = [...new Set(orders.map((order) => String(order.title)))];
  const visible = orders.filter((order) => (statusFilter === "all" || statusGroup(String(order.status)) === statusFilter) && (productFilter === "all" || String(order.title) === productFilter));
  let sumPackage = 0; let sumCost = 0; let sumProfit = 0; let sumDraft = 0; let sumFailed = 0; let sumCompleted = 0;
  for (const order of visible) {
    const price = order.price !== null && order.price !== undefined && String(order.price) !== "" ? Number(order.price) : NaN;
    const lines = orderCosts(order);
    const cost = lines ? lines.totalCents / 100 : NaN;
    const group = statusGroup(String(order.status));
    if (!Number.isNaN(price)) { sumPackage += price; if (group === "draft") sumDraft += price; if (group === "failed") sumFailed += price; if (group === "completed") sumCompleted += price; }
    if (!Number.isNaN(cost)) sumCost += cost;
    if (!Number.isNaN(price) && !Number.isNaN(cost)) sumProfit += price - cost;
  }
  const collected = 0; // Stripe is not connected and no payment rows link to projects yet, so nothing has been collected.

  return <div className="mgr-page">
    <PageHead eyebrow="Orders" title={customer ? "Customer orders" : "Orders"} sub={`${total} ${total === 1 ? "project" : "projects"}${customer ? ` for ${customer}` : ""} · showing ${orders.length}`}>
      <button type="button" className="text-btn" onClick={() => load(customer)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      <Link className="btn btn-white btn-sm" href="/dashboard">Client view</Link>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}

    <section className="metrics five" aria-label="Order totals">
      <Metric label="Orders" value={visible.length} note={statusFilter === "all" && productFilter === "all" ? "In this view" : "Matching filters"} />
      <Metric label="Package total" value={money(sumPackage)} note={`Ready ${money(sumCompleted)} · Saved ${money(sumDraft)} · Failed ${money(sumFailed)}`} />
      <Metric label="Collected" value={money(collected)} note="Stripe not connected" />
      <Metric label="Est. cost" value={money(sumCost)} note="Engine + music + editing" />
      <Metric label="Est. profit" value={money(sumProfit)} note="Not real margin yet" />
    </section>

    <section className="panel">
      <div className="filters">
        <div className="tabs" aria-label="Status">{statusFilters.map(([key, label]) => <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>{label}</button>)}</div>
        {products.length > 1 && <div className="tabs" aria-label="Product"><button type="button" aria-pressed={productFilter === "all"} onClick={() => setProductFilter("all")}>Every product</button>{products.map((product) => <button key={product} type="button" aria-pressed={productFilter === product} onClick={() => setProductFilter(product)}>{product}</button>)}</div>}
        {customer && <div className="chip-filter"><Icon name="user" size={14} /><span>{customer}</span><button type="button" onClick={() => setCustomerFilter("")} aria-label="Clear customer filter">×</button></div>}
      </div>

      <div className="table orders" role="table" aria-label="Orders">
        <div className="table-head" role="row"><span>Order</span><span>Customer</span><span>Package</span><span>Cost</span><span>Profit</span><span>Status</span></div>
        {loading && !orders.length ? <div className="empty-soft compact"><span>Loading orders…</span></div> : visible.length ? visible.map((order) => {
          const hasPrice = order.price !== null && order.price !== undefined && String(order.price) !== "";
          const price = hasPrice ? Number(order.price) : 0;
          const lines = orderCosts(order);
          const hasCost = Boolean(lines);
          const cost = lines ? lines.totalCents / 100 : 0;
          return <Link role="row" className="table-row" href={`/admin/projects/${String(order.id)}`} key={String(order.id)}>
            <span className="cell-main"><strong>{String(order.title)}</strong><small>{order.listingAddress ? `${String(order.listingAddress)} · ` : ""}Placed {placed(Number(order.createdAt || order.updatedAt))} · updated {ago(Number(order.updatedAt))} · {Number(order.assetCount || 0)} photos</small>{order.shortMessage && <small className="cell-note">{String(order.shortMessage)}</small>}</span>
            <span className="cell-person"><strong>{String(order.ownerName || order.ownerEmail || "Unknown")}</strong><small>{String(order.ownerEmail || "")}</small></span>
            <span className="cell-num" data-label="Package">{hasPrice ? money(price) : "—"}</span>
            <span className="cell-num" data-label="Cost">{lines ? <><strong>{cents(lines.totalCents)}</strong><small className="cost-split">Engine {cents(lines.videoCents)} · Music {cents(lines.musicCents)} · Edit {cents(lines.editCents)}</small></> : "—"}</span>
            <span className="cell-num" data-label="Profit">{hasPrice && hasCost ? money(price - cost) : "—"}</span>
            <span><StatusPill status={String(order.status)} /></span>
          </Link>;
        }) : <div className="empty-soft compact"><strong>{orders.length ? "No orders match these filters" : "No projects yet"}</strong><span>{orders.length ? "Try a different status or product." : "New client orders will appear here."}</span></div>}
      </div>
      {total > orders.length && <div className="table-more"><button type="button" className="btn btn-soft btn-sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more orders"}</button></div>}
      <p className="fine">Package totals are what each order is priced at, not collected payments. Cost = video engine (recorded when production started) + music and editing (calculated from the film&apos;s length and list prices). Not metered provider bills; see Finance for the full breakdown.</p>
    </section>

    <section className="panel maintenance">
      <div><strong>Clean up</strong><small>Delete failed removes only your own failed projects. Clear test rows removes your saved and failed tests. Real client orders are never touched.</small>{cleanupMessage && <small className="note" role="status">{cleanupMessage}</small>}</div>
      <span className="actions"><button type="button" className="btn btn-danger btn-sm" onClick={() => clearTestRows("failed")} disabled={clearing}>{clearing ? "Clearing…" : "Delete failed"}</button><button type="button" className="btn btn-danger btn-sm" onClick={() => clearTestRows()} disabled={clearing}>{clearing ? "Clearing…" : "Clear test rows"}</button></span>
    </section>
  </div>;
}
