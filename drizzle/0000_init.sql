CREATE TABLE "activity_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"at" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"summary" text NOT NULL,
	"details" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"agent" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"temperature_x100" integer NOT NULL,
	"sent" jsonb NOT NULL,
	"received" text,
	"latency_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"raw" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"resolution" text,
	"resolution_reason" text,
	"library_item_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"input" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'sky' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"csl" jsonb NOT NULL,
	"raw" text,
	"origin" text NOT NULL,
	"doi" text,
	"isbn" text,
	"title" text NOT NULL,
	"year" integer,
	"first_author" text,
	"venue" text,
	"status" text NOT NULL,
	"score" integer,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification" jsonb,
	"override" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"question" text NOT NULL,
	"state" text NOT NULL,
	"mode" text NOT NULL,
	"plan" jsonb,
	"plan_approved_at" timestamp with time zone,
	"search_report" jsonb,
	"sources" jsonb,
	"sources_approved_at" timestamp with time zone,
	"draft" jsonb,
	"summary_approved_at" timestamp with time zone,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_hash" text,
	"policy" jsonb
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_ws_idx" ON "activity_log" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "ai_calls_ws_idx" ON "ai_calls" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_calls_run_idx" ON "ai_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_items_audit_idx" ON "audit_items" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audits_ws_idx" ON "audits" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "folders_ws_idx" ON "folders" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "library_ws_idx" ON "library_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "library_ws_doi_idx" ON "library_items" USING btree ("workspace_id","doi");--> statement-breakpoint
CREATE INDEX "runs_ws_idx" ON "research_runs" USING btree ("workspace_id");