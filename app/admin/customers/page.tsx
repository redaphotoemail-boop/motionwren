"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../ui-icon";
import { Metric, PageHead, ago, cents, money } from "../ui";

type Customer = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "customer";
  status: string;
  plan: string;
  creditBalance: number;
  createdAt: number;
  updatedAt: number;
  projectCount: number;
  activeProjects: number;
  deliveredProjects: number;
  lastProjectAt: number | null;
  costCents?: number;
  jobCount?: number;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "delivered">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/customers", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Customers could not be loaded.");
      setCustomers(data.customers || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Customers could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void Promise.resolve().then(load); }, []);

  const visibleCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesQuery = !needle || customer.displayName.toLowerCase().includes(needle) || customer.email.toLowerCase().includes(needle);
      const matchesFilter = filter === "all" || (filter === "active" ? Number(customer.activeProjects) > 0 : Number(customer.deliveredProjects) > 0);
      return matchesQuery && matchesFilter;
    });
  }, [customers, filter, query]);

  const customerAccounts = customers.filter((customer) => customer.role === "customer");
  const active = customerAccounts.filter((customer) => Number(customer.activeProjects) > 0).length;
  const delivered = customerAccounts.reduce((total, customer) => total + Number(customer.deliveredProjects || 0), 0);
  const customerCost = customerAccounts.reduce((total, customer) => total + Number(customer.costCents || 0), 0) / 100;

  return <div className="mgr-page">
    <PageHead eyebrow="Customers" title="Every account in one place" sub="Who your customers are, what they ordered and what their videos cost to make.">
      <button type="button" className="text-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
    </PageHead>
    {error && <div className="notice notice-bad" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}

    <section className="metrics" aria-label="Customer totals">
      <Metric label="Customer accounts" value={customerAccounts.length} />
      <Metric label="In production" value={active} note="Customers with active videos" />
      <Metric label="Videos delivered" value={delivered} />
      <Metric label="Customer production cost" value={money(customerCost)} note="Estimated, excludes your own tests" />
    </section>

    <section className="panel">
      <div className="filters">
        <label className="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" aria-label="Search customers" /></label>
        <div className="tabs" aria-label="Filter">{(["all", "active", "delivered"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "active" ? "Active" : "Delivered"}</button>)}</div>
      </div>

      <div className="table customers" role="table" aria-label="Customers">
        <div className="table-head" role="row"><span>Customer</span><span>Plan</span><span>Orders</span><span>Delivered</span><span>Est. cost</span><span>Last activity</span></div>
        {loading && !customers.length ? <div className="empty-soft compact"><span>Loading customers…</span></div> : visibleCustomers.length ? visibleCustomers.map((customer) => <Link role="row" className="table-row" href={`/admin/orders?customer=${encodeURIComponent(customer.email)}`} key={customer.id}>
          <span className="cell-person with-avatar"><span className="avatar sm" aria-hidden="true">{(customer.displayName || customer.email).slice(0, 1).toUpperCase()}</span><span><strong>{customer.displayName}</strong><small>{customer.email}</small></span></span>
          <span data-label="Plan"><span className="tag">{customer.role === "admin" ? "owner" : customer.plan}</span>{customer.plan !== "internal" && <small className="cell-sub">{customer.creditBalance} credits</small>}</span>
          <span className="cell-num" data-label="Orders">{customer.projectCount}{Number(customer.activeProjects) > 0 && <small className="cell-sub">{customer.activeProjects} active</small>}</span>
          <span className="cell-num" data-label="Delivered">{customer.deliveredProjects}</span>
          <span className="cell-num" data-label="Est. cost">{cents(customer.costCents)}{Number(customer.jobCount || 0) > 0 && <small className="cell-sub">{customer.jobCount} job{customer.jobCount === 1 ? "" : "s"}</small>}</span>
          <span className="cell-time"><strong>{customer.lastProjectAt ? ago(customer.lastProjectAt) : "No orders"}</strong><small>Joined {new Date(customer.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></span>
        </Link>) : <div className="empty-soft compact"><strong>No matching customers</strong><span>Change the search or filter.</span></div>}
      </div>
      <p className="fine">Select a customer to see each of their orders with its estimated cost.</p>
    </section>
  </div>;
}
