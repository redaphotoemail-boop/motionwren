import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const generationHistory = sqliteTable("generation_history", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  r2Key: text("r2_key").notNull().unique(),
  prompt: text("prompt").notNull(),
  engine: text("engine").notNull(),
  category: text("category").notNull(),
  resolution: text("resolution").notNull(),
  aspect: text("aspect").notNull(),
  duration: integer("duration").notNull(),
  costCents: integer("cost_cents").notNull(),
  sizeBytes: integer("size_bytes"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("generation_history_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const renderJobs = sqliteTable("render_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  predictionIds: text("prediction_ids").notNull(),
  segmentUrls: text("segment_urls").notNull(),
  stitchPredictionId: text("stitch_prediction_id"),
  prompt: text("prompt").notNull(),
  category: text("category").notNull(),
  resolution: text("resolution").notNull(),
  aspect: text("aspect").notNull(),
  duration: integer("duration").notNull(),
  costCents: integer("cost_cents").notNull(),
  error: text("error"),
  historyId: text("history_id"),
  webhookToken: text("webhook_token"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("render_jobs_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt)]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("customer"),
  status: text("status").notNull().default("active"),
  plan: text("plan").notNull().default("internal"),
  creditBalance: integer("credit_balance").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("users_email_idx").on(table.email)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  listingUrl: text("listing_url"),
  listingAddress: text("listing_address"),
  beds: text("beds"),
  baths: text("baths"),
  squareFeet: text("square_feet"),
  price: text("price"),
  shortMessage: text("short_message"),
  aspect: text("aspect").notNull().default("horizontal"),
  resolution: text("resolution").notNull().default("1080p"),
  generationEngine: text("generation_engine").notNull().default("studio"),
  targetDuration: integer("target_duration").notNull().default(20),
  agentName: text("agent_name"),
  agentEmail: text("agent_email"),
  agentPhone: text("agent_phone"),
  renderJobId: text("render_job_id"),
  finalHistoryId: text("final_history_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("projects_owner_created_idx").on(table.ownerId, table.createdAt), index("projects_status_updated_idx").on(table.status, table.updatedAt)]);

export const projectAssets = sqliteTable("project_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull().default("source_image"),
  r2Key: text("r2_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  providerToken: text("provider_token"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("project_assets_project_order_idx").on(table.projectId, table.sortOrder), index("project_assets_owner_idx").on(table.ownerId)]);

export const creditLedger = sqliteTable("credit_ledger", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  projectId: text("project_id"),
  renderJobId: text("render_job_id"),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("credit_ledger_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  providerSubscriptionId: text("provider_subscription_id").unique(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: integer("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("subscriptions_owner_status_idx").on(table.ownerId, table.status)]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  providerPaymentId: text("provider_payment_id"),
  plan: text("plan").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("payments_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  readAt: integer("read_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("notifications_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("audit_events_actor_created_idx").on(table.actorId, table.createdAt), index("audit_events_entity_idx").on(table.entityType, table.entityId)]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("rate_limits_updated_idx").on(table.updatedAt)]);
