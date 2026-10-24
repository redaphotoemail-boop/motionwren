"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../ui-icon";

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

  return <main className="portal-shell admin-shell owner-dashboard">
    <header className="portal-header owner-header">
      <Link className="brand" href="/"><span className="brand-mark">FM</span><span>Frame Motion</span></Link>
      <nav><Link href="/admin"><Icon name="dashboard" size={16}/>Overview</Link><Link href="/admin/customers" className="active"><Icon name="user" size={16}/>Customers</Link><Link href="/studio"><Icon name="studio" size={16}/>Studio</Link></nav>
      <div className="account-actions"><button className="refresh-admin" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button><a className="sign-out-link" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a></div>
    </header>

    <section className="portal-content owner-content customer-crm">
      <div className="owner-welcome"><div><span className="owner-only"><Icon name="shield" size={14}/>Owner only</span><h1>Customers</h1><p>Accounts, production activity, credits and delivery history.</p></div><div><Link className="owner-access" href="/admin"><Icon name="dashboard" size={17}/>Business overview</Link><Link className="primary-action" href="/dashboard"><Icon name="projects" size={17}/>Client experience</Link></div></div>
      {error && <div className="portal-alert error" role="alert">{error}</div>}

      <section className="crm-summary"><article><span>Customer accounts</span><strong>{customerAccounts.length}</strong></article><article><span>In production</span><strong>{active}</strong></article><article><span>Videos delivered</span><strong>{delivered}</strong></article></section>

      <section className="owner-panel crm-directory"><div className="crm-toolbar"><div><span className="label">CUSTOMER DIRECTORY</span><h2>Every account in one place</h2></div><div className="crm-controls"><label><Icon name="projects" size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" aria-label="Search customers"/></label><div>{(["all","active","delivered"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}</button>)}</div></div></div>
        {loading ? <div className="owner-empty"><span>Loading customers…</span></div> : visibleCustomers.length ? <div className="crm-table"><div className="crm-table-head"><span>Customer</span><span>Plan</span><span>Credits</span><span>Projects</span><span>Delivered</span><span>Last activity</span></div>{visibleCustomers.map((customer) => <div className="crm-table-row" key={customer.id}><span><i>{customer.displayName.slice(0, 1).toUpperCase()}</i><span><strong>{customer.displayName}</strong><small>{customer.email}</small></span></span><span><b className="crm-plan">{customer.role === "admin" ? "owner" : customer.plan}</b></span><span>{customer.plan === "internal" ? "—" : customer.creditBalance}</span><span>{customer.projectCount}</span><span>{customer.deliveredProjects}</span><span><strong>{customer.lastProjectAt ? new Date(customer.lastProjectAt).toLocaleDateString() : "No projects"}</strong><small>Joined {new Date(customer.createdAt).toLocaleDateString()}</small></span></div>)}</div> : <div className="owner-empty"><Icon name="user"/><strong>No matching customers</strong><span>Change the search or filter.</span></div>}
      </section>
    </section>
  </main>;
}
