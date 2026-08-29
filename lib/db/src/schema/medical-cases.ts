import {
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const medicalCasesTable = pgTable("medical_cases", {
  id: serial("id").primaryKey(),
  patientLabel: text("patient_label").notNull(),
  title: text("title").notNull(),
  specialty: text("specialty").notNull(),
  status: text("status").notNull().default("active"),
  priority: text("priority").notNull().default("normal"),
  confidence: real("confidence").notNull().default(0.86),
  age: integer("age"),
  sex: text("sex"),
  tags: text("tags").array().notNull().default([]),
  summary: text("summary").notNull().default(""),
  findings: jsonb("findings").$type<
    Array<{ label: string; value: string; tone: string }>
  >().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const caseMessagesTable = pgTable("case_messages", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => medicalCasesTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: text("citations").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMedicalCaseSchema = createInsertSchema(medicalCasesTable).omit({
  id: true,
  updatedAt: true,
  createdAt: true,
});
export type InsertMedicalCase = z.infer<typeof insertMedicalCaseSchema>;
export type MedicalCase = typeof medicalCasesTable.$inferSelect;
export type CaseMessage = typeof caseMessagesTable.$inferSelect;
export type ActivityItem = typeof activityTable.$inferSelect;