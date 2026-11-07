import type { Role } from "@/spacetimedb/src/shared/policy";

export const ROLE_LABELS: Record<Role, string> = {
  commander: "Commander",
  counsel: "Counsel",
  technical: "Technical",
  executive: "Executive",
};

export const CHANNEL_LABELS = {
  record: "#record",
  command: "#command",
  privileged: "#privileged",
  technical: "#technical",
} as const;

const PHASE_LABELS: Record<string, string> = {
  preparation: "Preparation",
  detection_analysis: "Detection and analysis",
  containment: "Containment",
  eradication: "Eradication",
  recovery: "Recovery",
  post_incident: "Post-incident",
};

const SCOPE_STATUS_LABELS: Record<string, string> = {
  unknown: "Unknown",
  suspected: "Suspected",
  encrypted: "Encrypted",
  exfiltrated: "Exfiltrated",
  contained: "Contained",
  eradicated: "Eradicated",
  restored: "Restored",
};

const ASSET_LABELS: Record<string, string> = {
  endpoint: "Endpoint",
  server: "Server",
  database: "Database",
  saas: "SaaS",
  backup: "Backup",
  network: "Network",
  other: "Other",
};

const TASK_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

const DATA_LABELS: Record<string, string> = {
  ssn: "SSN",
  drivers_license: "Driver license",
  financial_account: "Financial account",
  payment_card: "Payment card",
  phi: "PHI",
  credentials: "Credentials",
  biometric: "Biometric",
  employee_hr: "Employee HR",
  privileged_legal: "Privileged legal",
  trade_secret: "Trade secret",
  other_pii: "Other personal data",
};

const MEMBER_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  revoked: "Revoked",
};

function label(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}

export const phaseLabel = (value: string) => label(PHASE_LABELS, value);
export const scopeStatusLabel = (value: string) => label(SCOPE_STATUS_LABELS, value);
export const assetLabel = (value: string) => label(ASSET_LABELS, value);
export const taskStatusLabel = (value: string) => label(TASK_LABELS, value);
export const dataTypeLabel = (value: string) => label(DATA_LABELS, value);
export const memberStateLabel = (value: string) => label(MEMBER_STATE_LABELS, value);

export function connectionLabel(connection: "connecting" | "ready" | "offline" | "error", mock: boolean): string {
  if (mock && connection === "ready") return "Demo session";
  if (connection === "ready") return "Connected";
  if (connection === "connecting") return "Connecting";
  if (connection === "offline") return "Offline";
  return "Error";
}
