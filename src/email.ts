import { env } from "./env.js";
import { permitPacketPdf } from "./exports.js";
import type { InspectionReport } from "./types.js";

export interface PermitEmailResult {
  sent: boolean;
  id?: string;
  error?: string;
}

// PE permit approval email via Resend (https://api.resend.com/emails) with the
// stamped permit packet PDF attached. No-ops with a clear error when unconfigured.
export async function sendPermitApprovalEmail(
  to: string,
  report: InspectionReport,
): Promise<PermitEmailResult> {
  if (!env.resendApiKey) return { sent: false, error: "RESEND_API_KEY not configured" };
  try {
    const pdf = await permitPacketPdf(report);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFrom,
        to: [to],
        subject: `PlanPass Permit Packet ${report.status} — ${report.inspectionId} (${report.readinessScore}/100)`,
        html:
          `<p>Permit Compliance Packet for inspection <strong>${report.inspectionId}</strong>.</p>` +
          `<p>Occupancy: ${report.occupancy} &middot; Readiness score: ${report.readinessScore}/100 &middot; Status: ${report.status === "APPROVED" ? "APPROVED FOR PE SIGN-OFF" : "HOLD — REVISIONS REQUIRED"}</p>` +
          `<p>The permit packet PDF reflecting the real inspection result is attached.</p>`,
        attachments: [
          {
            filename: `permit-packet-${report.inspectionId}.pdf`,
            content: Buffer.from(pdf).toString("base64"),
          },
        ],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { sent: false, error: `Resend HTTP ${res.status}: ${data.message ?? "send failed"}` };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}
