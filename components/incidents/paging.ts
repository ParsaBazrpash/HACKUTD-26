import type { IncidentState, PageView, RosterMember } from "@/lib/client/types";

export type PickRole = "counsel" | "technical" | "executive";

export function isPickRole(value: string): value is PickRole {
  return value === "counsel" || value === "technical" || value === "executive";
}

/** Commander who is active in the open incident and sees an org roster. */
export function canPage(state: Pick<IncidentState, "me" | "org">): boolean {
  return state.me?.role === "commander" && state.me.state === "active" && state.org?.myRole === "admin";
}

export type PickCheck = { pickable: true } | { pickable: false; reason: string };

/** Roster members who may be added to this incident, or the short reason they may not. */
export function pickCheck(member: RosterMember): PickCheck {
  if (member.state === "pending") return { pickable: false, reason: "Waiting for approval" };
  if (member.state === "revoked") return { pickable: false, reason: "Revoked" };
  if (member.keyChanged) return { pickable: false, reason: "Key changed, confirm with them first" };
  return { pickable: true };
}

/** Roster members whose identity is not already in this incident (any state but revoked). */
export function notInIncident(roster: RosterMember[], incidentIdentities: Set<string>): RosterMember[] {
  return roster.filter((member) => !incidentIdentities.has(member.identity));
}

export type ChipTone = "neutral" | "progress" | "good" | "alert";

export type PageChip = { label: string; hint: string | null; tone: ChipTone; retry: boolean };

/** One honest chip per page. Acknowledged is the carrier's word, joined needs a signed action. */
export function pageChip(page: PageView): PageChip {
  if (page.joined) {
    return { label: "Joined", hint: "Posted in the room with a signed action.", tone: "good", retry: false };
  }
  switch (page.status) {
    case "requested":
      return {
        label: "Requested",
        hint: "Waiting for the paging service. If it stays here, use Retry call.",
        tone: "neutral",
        retry: true,
      };
    case "calling":
      return { label: "Calling", hint: null, tone: "progress", retry: false };
    case "ringing":
      return { label: "Ringing", hint: null, tone: "progress", retry: false };
    case "acknowledged":
      return {
        label: "Acknowledged",
        hint: page.carrierReported ? "By phone, reported by the carrier." : "By phone, not yet confirmed by the carrier.",
        tone: "good",
        retry: false,
      };
    case "no_answer":
      return { label: "No answer", hint: null, tone: "alert", retry: true };
    case "busy":
      return { label: "Busy", hint: null, tone: "alert", retry: true };
    case "failed":
      return { label: "Failed", hint: null, tone: "alert", retry: true };
  }
}

/** Latest page per person. */
export function latestPages(pages: PageView[]): PageView[] {
  const map = new Map<bigint, PageView>();
  for (const page of pages) {
    const prior = map.get(page.orgMemberId);
    if (!prior || prior.updatedAt <= page.updatedAt) map.set(page.orgMemberId, page);
  }
  return [...map.values()];
}

export type Reachability = {
  paged: number;
  acknowledged: number;
  joined: number;
  joinedNames: string[];
  acknowledgedNames: string[];
};

/** Counts for the "Who is reachable" strip. Joined people are not counted twice as acknowledged. */
export function reachability(pages: PageView[]): Reachability {
  const latest = latestPages(pages);
  const joined = latest.filter((page) => page.joined);
  const acknowledged = latest.filter((page) => !page.joined && page.status === "acknowledged");
  return {
    paged: latest.length,
    acknowledged: acknowledged.length,
    joined: joined.length,
    joinedNames: joined.map((page) => page.displayName),
    acknowledgedNames: acknowledged.map((page) => page.displayName),
  };
}

/** A roster-added member who is in the org, active, not the commander, and has not posted yet. */
export function showImHere(state: Pick<IncidentState, "me" | "org" | "channels" | "timeline">): boolean {
  const me = state.me;
  if (!me || me.state !== "active" || me.role === "commander" || !state.org) return false;
  const mine = (identity: string | undefined) => identity === me.identity;
  if (state.channels.some((channel) => channel.messages.some((message) => mine(message.author?.identity)))) return false;
  if (state.timeline.some((item) => mine(item.by?.identity))) return false;
  return true;
}
