import { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";
import { sendSubmissionEmail, isEmailConfigured } from "../email.js";

// ---- Types ----

export type SubmissionType = "visit" | "travel" | "expense" | "leave";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Submission {
  pk: string;        // USER#<userId>
  sk: string;        // SUBMISSION#<id>
  gsi1pk: string;    // SUBMISSION#<type> (for RM queries)
  gsi1sk: string;    // SUBMISSION#<submittedAt>
  gsi2pk: string;    // USER#<userId>#<type>
  gsi2sk: string;    // SUBMISSION#<submittedAt>
  entityType: "Submission";
  id: string;
  userId: string;
  type: SubmissionType;
  status: SubmissionStatus;
  data: Record<string, any>;
  submittedAt: string;
  updatedAt: string;
}

// ---- CRUD ----

export async function create(req: Request, res: Response) {
  try {
    const { type, data } = req.body;
    if (!type || !data) {
      return res.status(400).json({ error: "Type and data are required" });
    }

    const validTypes: SubmissionType[] = ["visit", "travel", "expense", "leave"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    }

    const id = uuid();
    const now = db.nowISO();
    const userId = req.user!.userId;

    const submission: Submission = {
      pk: `USER#${userId}`,
      sk: `SUBMISSION#${id}`,
      gsi1pk: `SUBMISSION#${type}`,
      gsi1sk: `SUBMISSION#${now}`,
      gsi2pk: `USER#${userId}#${type}`,
      gsi2sk: `SUBMISSION#${now}`,
      entityType: "Submission",
      id,
      userId,
      type,
      status: "pending",
      data,
      submittedAt: now,
      updatedAt: now,
    };

    await db.putItem(submission);

    // Fire-and-forget: notify the reporting manager
    try {
      if (isEmailConfigured()) {
        // Find the RM for this user
        const users = await db.scanByType("User");
        const submitter = users.find((u: any) => u.id === userId);
        const rmId = submitter?.reportingManagerId;
        if (rmId) {
          const rm = users.find((u: any) => u.id === rmId);
          if (rm?.email) {
            const submitterName = submitter?.contactName || submitter?.email || "Team member";
            sendSubmissionEmail({
              type: "new_request",
              submissionType: type,
              submitterName,
              submitterEmail: req.user!.email,
              recipientEmail: rm.email,
              recipientName: rm.contactName || rm.email || "Manager",
              data,
              submissionId: id,
            }).catch((err) => console.error(`  ⚠ Failed to send submission email:`, err));
          }
        }
      }
    } catch (emailErr) {
      console.error(`  ⚠ Error sending submission notification:`, emailErr);
    }

    return res.status(201).json(submission);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function list(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const typeFilter = req.query.type as string | undefined;
    const all = await db.scanByType("Submission");
    const userSubmissions = all.filter((s: any) => s.userId === userId);
    const result = typeFilter
      ? userSubmissions.filter((s: any) => s.type === typeFilter)
      : userSubmissions;
    result.sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const item = await db.getItem(`USER#${userId}`, `SUBMISSION#${id}`);
    if (!item) return res.status(404).json({ error: "Submission not found" });

    const allowed = ["data", "status"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updatedAt = db.nowISO();

    const result = await db.updateItem(`USER#${userId}`, `SUBMISSION#${id}`, updates);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    await db.deleteItem(`USER#${userId}`, `SUBMISSION#${id}`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---- Reporting Manager: Get team requests ----

export async function listTeamRequests(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes("reporting_manager")) {
      return res.status(403).json({ error: "Reporting manager access required" });
    }
    const managerId = req.user!.userId;
    const typeFilter = req.query.type as string | undefined;

    // Get all users managed by this RM
    const users = await db.scanByType("User");
    const teamIds = users
      .filter((u: any) => u.reportingManagerId === managerId)
      .map((u: any) => u.id);

    // Get all submissions
    const all = await db.scanByType("Submission");
    const teamSubmissions = all.filter((s: any) => teamIds.includes(s.userId));

    const result = typeFilter
      ? teamSubmissions.filter((s: any) => s.type === typeFilter)
      : teamSubmissions;

    // Enrich with user info
    const userMap = new Map<string, any>();
    users.forEach((u: any) => userMap.set(u.id, u));

    const enriched = result.map((s: any) => ({
      ...s,
      user: userMap.get(s.userId) ? {
        id: userMap.get(s.userId).id,
        email: userMap.get(s.userId).email,
        contactName: userMap.get(s.userId).contactName,
        companyName: userMap.get(s.userId).companyName,
        roles: userMap.get(s.userId).roles,
      } : null,
    }));

    enriched.sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt));
    return res.json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateRequestStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const managerId = req.user!.userId;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    // Find the submission by scanning (we don't know the userId)
    const all = await db.scanByType("Submission");
    const submission = all.find((s: any) => s.id === id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    // Verify the user is managed by this RM
    const user = await db.getItem(`USER#${submission.userId}`);
    if (!user || (user as any).reportingManagerId !== managerId) {
      return res.status(403).json({ error: "Not authorized to manage this request" });
    }

    const result = await db.updateItem(`USER#${submission.userId}`, `SUBMISSION#${id}`, { status, updatedAt: db.nowISO() });

    // Fire-and-forget: notify the submitter
    try {
      if (isEmailConfigured()) {
        const allUsers = await db.scanByType("User");
        const submitter = allUsers.find((u: any) => u.id === submission.userId);
        const manager = allUsers.find((u: any) => u.id === managerId);
        if (submitter?.email && manager) {
          const submitterName = submitter.contactName || submitter.email || "Team member";
          const managerName = manager.contactName || manager.email || "Manager";
          sendSubmissionEmail({
            type: "status_update",
            submissionType: submission.type,
            submitterName,
            submitterEmail: submitter.email,
            recipientEmail: submitter.email,
            recipientName: managerName,
            status,
            data: submission.data,
            submissionId: id,
          }).catch((err) => console.error(`  ⚠ Failed to send status email:`, err));
        }
      }
    } catch (emailErr) {
      console.error(`  ⚠ Error sending status notification:`, emailErr);
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
