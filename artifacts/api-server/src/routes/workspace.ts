import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  CreateCaseBody,
  GetCaseParams,
  GetCaseReportParams,
  ListCasesQueryParams,
  SendCaseMessageBody,
  SendCaseMessageParams,
  UpdateCaseBody,
  UpdateCaseParams,
} from "@workspace/api-zod";
import { db, activityTable, caseMessagesTable, medicalCasesTable } from "@workspace/db";

const router: IRouter = Router();

type Finding = { label: string; value: string; tone: string };

const starterCases = [
  {
    patientLabel: "Patient A-104",
    title: "Persistent cough and fatigue",
    specialty: "Internal medicine",
    status: "active",
    priority: "urgent",
    confidence: 0.91,
    age: 48,
    sex: "Female",
    tags: ["respiratory", "follow-up"],
    summary:
      "A 48-year-old patient with a 3-week cough, fatigue, and intermittent low-grade fever. The pattern warrants respiratory imaging and review of recent exposures.",
    findings: [
      { label: "Urgency", value: "Review within 24 hours", tone: "urgent" },
      { label: "Primary signal", value: "Lower respiratory involvement", tone: "caution" },
      { label: "Confidence", value: "91%", tone: "positive" },
    ] satisfies Finding[],
  },
  {
    patientLabel: "Patient B-219",
    title: "Type 2 diabetes follow-up",
    specialty: "Endocrinology",
    status: "review",
    priority: "normal",
    confidence: 0.86,
    age: 62,
    sex: "Male",
    tags: ["metabolic", "routine"],
    summary:
      "Follow-up review of glucose control and medication adherence. Trends are stable with an opportunity to reinforce lifestyle recommendations.",
    findings: [
      { label: "Glycemic trend", value: "Stable over 90 days", tone: "positive" },
      { label: "Next step", value: "Review HbA1c at visit", tone: "neutral" },
      { label: "Confidence", value: "86%", tone: "positive" },
    ] satisfies Finding[],
  },
  {
    patientLabel: "Patient C-087",
    title: "Migraine pattern review",
    specialty: "Neurology",
    status: "active",
    priority: "normal",
    confidence: 0.78,
    age: 31,
    sex: "Female",
    tags: ["neurology", "new"],
    summary:
      "New episodic headache pattern with no reported focal neurological deficit. Clarify triggers, duration, and red-flag symptoms during intake.",
    findings: [
      { label: "Red flags", value: "None reported", tone: "positive" },
      { label: "Information gap", value: "Trigger history needed", tone: "caution" },
      { label: "Confidence", value: "78%", tone: "neutral" },
    ] satisfies Finding[],
  },
];

const assistantReply =
  "Based on the available information, I would prioritize confirming the timeline, reviewing red-flag symptoms, and correlating the findings with the cited clinical references. This is decision support, not a diagnosis.";

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCase(row: typeof medicalCasesTable.$inferSelect) {
  return {
    id: row.id,
    patientLabel: row.patientLabel,
    title: row.title,
    specialty: row.specialty,
    status: row.status as "active" | "review" | "archived",
    priority: row.priority as "normal" | "urgent",
    updatedAt: iso(row.updatedAt),
    confidence: row.confidence,
    age: row.age,
    sex: row.sex,
    tags: row.tags,
  };
}

function toMessage(row: typeof caseMessagesTable.$inferSelect) {
  return {
    id: row.id,
    role: row.role as "doctor" | "assistant" | "system",
    content: row.content,
    createdAt: iso(row.createdAt),
    citations: row.citations,
  };
}

async function ensureSeeded() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(medicalCasesTable);
  if (Number(count) > 0) return;

  const cases = await db
    .insert(medicalCasesTable)
    .values(starterCases)
    .returning();
  await db.insert(caseMessagesTable).values([
    {
      caseId: cases[0].id,
      role: "system",
      content: "Case created from a physician intake. Add clinical context to begin analysis.",
      citations: [],
    },
    {
      caseId: cases[0].id,
      role: "doctor",
      content: "Patient has reported a persistent cough for three weeks with fatigue and intermittent low-grade fever.",
      citations: [],
    },
    {
      caseId: cases[0].id,
      role: "assistant",
      content: "The duration and associated symptoms suggest reviewing respiratory red flags and recent exposure history before the next clinical decision.",
      citations: ["NICE respiratory assessment guidance", "BMJ Best Practice"],
    },
    {
      caseId: cases[1].id,
      role: "system",
      content: "Imported follow-up note. Review the summary and add new lab values when available.",
      citations: [],
    },
  ]);
  await db.insert(activityTable).values([
    {
      type: "analysis",
      title: "Analysis completed",
      detail: "Patient A-104 · respiratory review",
    },
    {
      type: "report",
      title: "Report generated",
      detail: "Patient B-219 · endocrinology",
    },
    {
      type: "upload",
      title: "Lab results uploaded",
      detail: "Patient C-087 · 4 files",
    },
  ]);
}

router.get("/dashboard", async (req, res) => {
  await ensureSeeded();
  const rows = await db.select().from(medicalCasesTable);
  const activeCases = rows.filter((row) => row.status === "active").length;
  const urgentAlerts = rows.filter(
    (row) => row.priority === "urgent" && row.status !== "archived",
  ).length;
  const accuracy =
    rows.length > 0
      ? Math.round(
          (rows.reduce((total, row) => total + row.confidence, 0) / rows.length) * 100,
        )
      : 0;
  res.json({
    activeCases,
    reviewedToday: rows.filter((row) => row.status === "review").length + 6,
    urgentAlerts,
    accuracy,
    trend: [72, 76, 74, 81, 83, 86, accuracy],
  });
});

router.get("/cases", async (req, res) => {
  await ensureSeeded();
  const params = ListCasesQueryParams.parse(req.query);
  const rows = await db.select().from(medicalCasesTable).orderBy(desc(medicalCasesTable.updatedAt));
  const filtered = rows.filter((row) => {
    const statusMatches = !params.status || row.status === params.status;
    const search = params.search?.toLowerCase().trim();
    const searchMatches =
      !search ||
      [row.patientLabel, row.title, row.specialty, ...row.tags]
        .join(" ")
        .toLowerCase()
        .includes(search);
    return statusMatches && searchMatches;
  });
  res.json(filtered.map(toCase));
});

router.post("/cases", async (req, res) => {
  await ensureSeeded();
  const input = CreateCaseBody.parse(req.body);
  const [row] = await db
    .insert(medicalCasesTable)
    .values({
      patientLabel: input.patientLabel,
      title: input.title,
      specialty: input.specialty,
      age: input.age,
      sex: input.sex,
      tags: input.tags ?? [],
      summary: "New case ready for clinical context and analysis.",
      findings: [
        { label: "Status", value: "Awaiting analysis", tone: "neutral" },
        { label: "Confidence", value: "Not assessed", tone: "neutral" },
      ],
    })
    .returning();
  await db.insert(activityTable).values({
    type: "analysis",
    title: "New case created",
    detail: `${row.patientLabel} · ${row.specialty}`,
  });
  res.status(201).json(toCase(row));
});

router.get("/cases/:caseId", async (req, res) => {
  await ensureSeeded();
  const { caseId } = GetCaseParams.parse({ caseId: Number(req.params.caseId) });
  const [row] = await db
    .select()
    .from(medicalCasesTable)
    .where(eq(medicalCasesTable.id, caseId));
  if (!row) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const messages = await db
    .select()
    .from(caseMessagesTable)
    .where(eq(caseMessagesTable.caseId, caseId))
    .orderBy(caseMessagesTable.createdAt);
  res.json({
    ...toCase(row),
    messages: messages.map(toMessage),
    summary: row.summary,
    findings: row.findings,
  });
});

router.patch("/cases/:caseId", async (req, res) => {
  await ensureSeeded();
  const { caseId } = UpdateCaseParams.parse({ caseId: Number(req.params.caseId) });
  const input = UpdateCaseBody.parse(req.body);
  const [row] = await db
    .update(medicalCasesTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(medicalCasesTable.id, caseId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(toCase(row));
});

router.delete("/cases/:caseId", async (req, res) => {
  await ensureSeeded();
  const { caseId } = GetCaseParams.parse({ caseId: Number(req.params.caseId) });
  await db
    .update(medicalCasesTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(medicalCasesTable.id, caseId));
  res.status(204).send();
});

router.post("/cases/:caseId/messages", async (req, res) => {
  await ensureSeeded();
  const { caseId } = SendCaseMessageParams.parse({ caseId: Number(req.params.caseId) });
  const { content } = SendCaseMessageBody.parse(req.body);
  const [caseRow] = await db
    .select({ id: medicalCasesTable.id })
    .from(medicalCasesTable)
    .where(eq(medicalCasesTable.id, caseId));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  await db.insert(caseMessagesTable).values({ caseId, role: "doctor", content, citations: [] });
  const [reply] = await db
    .insert(caseMessagesTable)
    .values({
      caseId,
      role: "assistant",
      content: assistantReply,
      citations: ["Medelya clinical reasoning framework", "BMJ Best Practice"],
    })
    .returning();
  await db
    .update(medicalCasesTable)
    .set({ updatedAt: new Date() })
    .where(eq(medicalCasesTable.id, caseId));
  res.status(201).json(toMessage(reply));
});

router.get("/cases/:caseId/report", async (req, res) => {
  await ensureSeeded();
  const { caseId } = GetCaseReportParams.parse({ caseId: Number(req.params.caseId) });
  const [row] = await db
    .select()
    .from(medicalCasesTable)
    .where(eq(medicalCasesTable.id, caseId));
  if (!row) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json({
    caseId: row.id,
    title: `${row.patientLabel} · ${row.title}`,
    generatedAt: iso(row.updatedAt),
    sections: [
      { title: "Clinical context", body: row.summary },
      {
        title: "Key findings",
        body: (row.findings as Finding[])
          .map((finding) => `${finding.label}: ${finding.value}`)
          .join("\n"),
      },
      {
        title: "Safety note",
        body: "This report is decision support for a qualified clinician and does not replace clinical judgment.",
      },
    ],
  });
});

router.get("/activity", async (req, res) => {
  await ensureSeeded();
  const rows = await db.select().from(activityTable).orderBy(desc(activityTable.time)).limit(10);
  res.json(
    rows.map((row) => ({
      id: row.id,
      type: row.type as "analysis" | "report" | "upload" | "alert",
      title: row.title,
      detail: row.detail,
      time: iso(row.time),
    })),
  );
});

export default router;