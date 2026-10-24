import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at").notNull(),
}, (table) => [index("generation_history_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const clientJobs = sqliteTable("client_jobs", {
  id: text("id").primaryKey(),
  uploadTokenHash: text("upload_token_hash").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  businessName: text("business_name").notNull(),
  projectName: text("project_name").notNull(),
  packageSeconds: integer("package_seconds").notNull(),
  style: text("style").notNull(),
  notes: text("notes").notNull(),
  status: text("status").notNull(),
  photoCount: integer("photo_count").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
}, (table) => [
  index("client_jobs_status_created_idx").on(table.status, table.createdAt),
  index("client_jobs_email_created_idx").on(table.clientEmail, table.createdAt),
]);

export const jobAssets = sqliteTable("job_assets", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => clientJobs.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("job_assets_job_position_unique").on(table.jobId, table.position),
  index("job_assets_job_idx").on(table.jobId),
]);
