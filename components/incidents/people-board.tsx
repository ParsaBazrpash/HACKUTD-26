"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Clock,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { AccessControls, RoomAccessCard } from "@/components/incidents/access-controls";
import { AdmissionControls } from "@/components/incidents/admission-controls";
import { InviteControls } from "@/components/incidents/invite-controls";
import { memberStateLabel, ROLE_LABELS, CHANNEL_LABELS } from "@/components/incidents/labels";
import { PagePicker } from "@/components/incidents/page-picker";
import { ReissuedInvite, RevokeControl, type ReplaceOutcome } from "@/components/incidents/revoke-control";
import { FormStatus, secondaryButtonClass } from "@/components/incidents/form-ui";
import { ImHereButton, PagingStatus } from "@/components/incidents/paging-status";
import { linkVerifiedLabel } from "@/components/incidents/room-controls";
import { SafeText } from "@/components/incidents/safe-text";
import { LocalTime } from "@/components/local-time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { formatAgo } from "@/lib/client/presence";
import { isMockIncidentClient } from "@/lib/client";
import type { MemberView } from "@/lib/client/types";
import {
  CHANNELS,
  READ,
  ROLES,
  WRITE,
  canRead,
  isRole,
  type ChannelKind,
  type MemberStateName,
  type Role,
} from "@/spacetimedb/src/shared/policy";

type PeopleView = "members" | "invites" | "roles" | "requests";
type StateFilter = "all" | MemberStateName;
type AccessFilter = "all" | ReturnType<typeof accessLabel>;

const VIEWS: { id: PeopleView; label: string; icon: typeof Users }[] = [
  { id: "members", label: "Members", icon: Users },
  { id: "invites", label: "Invites", icon: Mail },
  { id: "roles", label: "Roles", icon: Shield },
  { id: "requests", label: "Access Requests", icon: Clock },
];

const filterClass =
  "h-10 appearance-none rounded-full border border-line bg-panel pl-3 pr-8 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

function accessLabel(role: Role): string {
  const missing = CHANNELS.filter((channel) => !canRead(role, channel));
  if (missing.length === 0) return "Full access";
  if (missing.length === 1 && missing[0] === "privileged") return "No privileged";
  if (missing.length === 1 && missing[0] === "technical") return "No technical";
  return "Limited";
}

function isStateFilter(value: string): value is StateFilter {
  return value === "all" || value === "active" || value === "pending" || value === "revoked";
}

function isAccessFilter(value: string): value is AccessFilter {
  return value === "all" || value === "Full access" || value === "No privileged" || value === "No technical" || value === "Limited";
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function shortFingerprint(fingerprint: string): string {
  const groups = fingerprint.split(" ").filter(Boolean);
  if (groups.length <= 2) return fingerprint;
  return `…${groups.slice(-2).join(" ")}`;
}

function statusTone(member: MemberView): { label: string; dot: string; text: string } {
  if (member.state === "pending") return { label: "Pending", dot: "bg-muted", text: "text-muted" };
  if (member.state === "revoked") return { label: "Revoked", dot: "bg-alert", text: "text-alert" };
  if (member.online === false) return { label: "Offline", dot: "bg-muted", text: "text-muted" };
  // Admitted is not the same as here: say Online only when the server reports a live connection.
  if (member.online === true) return { label: "Online", dot: "bg-signal", text: "text-signal" };
  return { label: "Active", dot: "bg-signal", text: "text-signal" };
}

function lastSeenText(member: MemberView, now: number | null): string | null {
  if (member.state !== "active" || member.online !== false) return null;
  if (!member.lastSeenAt) return "Not seen yet";
  return now === null ? null : `Last seen ${formatAgo(member.lastSeenAt, now)}`;
}

function matchesQuery(member: MemberView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const compact = q.replace(/\s+/g, "");
  return (
    member.displayName.toLowerCase().includes(q) ||
    member.fingerprint.toLowerCase().replace(/\s+/g, "").includes(compact)
  );
}

function rosterOrder(a: MemberView, b: MemberView): number {
  const rank = (member: MemberView) => (member.state === "active" ? 0 : member.state === "pending" ? 1 : 2);
  const byState = rank(a) - rank(b);
  if (byState !== 0) return byState;
  const byRole = ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
  if (byRole !== 0) return byRole;
  return a.joinedAt.getTime() - b.joinedAt.getTime();
}

function channelPhrase(role: Role, matrix: Record<ChannelKind, readonly Role[]>): string {
  const names = CHANNELS.filter((channel) => matrix[channel].includes(role)).map((channel) => CHANNEL_LABELS[channel]);
  if (names.length === 0) return "none";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function MemberFacts({ member, mock }: { member: MemberView; mock: boolean }) {
  return (
    <div className="grid gap-2 text-xs leading-5 text-muted">
      <p>
        <span className="text-foreground">Fingerprint </span>
        <span translate="no" className="break-all font-mono">
          {member.fingerprint}
        </span>
        {mock ? " · Demo fingerprint" : ""}
      </p>
      <p>
        {member.verified
          ? "Admission certificate checked"
          : mock
            ? "Demo roster. Certificates are not checked."
            : "Certificate not checked"}
      </p>
      {member.safetyCode ? (
        <p translate="no" className="break-words font-mono">
          Safety code {member.safetyCode}
          {mock ? " · Demo code" : ""}
        </p>
      ) : null}
      {member.state === "pending" ? (
        <p className={member.linkVerified === false ? "text-alert" : member.linkVerified === true ? "text-verified" : undefined}>
          {linkVerifiedLabel(member.linkVerified)}
          {mock && member.linkVerified === true ? ". Demo token matched. This is not a cryptographic link check." : ""}
        </p>
      ) : null}
    </div>
  );
}

function PersonCell({ member }: { member: MemberView }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-panel-raised text-xs font-medium"
      >
        {initial(member.displayName)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">
          <SafeText text={member.displayName} />
        </p>
        <p className="truncate font-mono text-xs text-muted" title={member.fingerprint}>
          <span className="sr-only">Fingerprint </span>
          <span translate="no">{shortFingerprint(member.fingerprint)}</span>
        </p>
      </div>
    </div>
  );
}

function RolePill({ role }: { role: Role }) {
  return (
    <span className="inline-flex rounded-full border border-line px-2.5 py-0.5 text-xs text-foreground">
      {ROLE_LABELS[role]}
    </span>
  );
}

function AccessPill({ role }: { role: Role }) {
  return (
    <span className="inline-flex rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{accessLabel(role)}</span>
  );
}

function StatusMark({ member }: { member: MemberView }) {
  const tone = statusTone(member);
  const now = useBrowserNow();
  const seen = lastSeenText(member, now);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone.text}`}>
        <span aria-hidden="true" className={`size-1.5 rounded-full ${tone.dot}`} />
        {tone.label}
      </span>
      {seen ? <span className="text-[11px] text-muted">{seen}</span> : null}
    </span>
  );
}

export function PeopleBoard() {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const commander = state.me?.role === "commander" && state.me.state === "active";
  const [view, setView] = useState<PeopleView>("members");
  const [menu, setMenu] = useState(false);
  const pendingCount = state.members.filter((member) => member.state === "pending").length;

  function openView(next: PeopleView) {
    setMenu(false);
    setView(next);
  }

  function addMember() {
    setView("members");
    setMenu(false);
    window.setTimeout(() => {
      const node = document.getElementById("invite-role");
      if (!(node instanceof HTMLElement)) return;
      node.focus();
      node.scrollIntoView({ block: "center", behavior: "auto" });
    }, 0);
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label="People and access" className="min-w-0 lg:sticky lg:top-4">
        <p className="mb-3 hidden text-sm font-medium lg:block">People & Access</p>
        <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto lg:grid lg:overflow-visible">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => openView(item.id)}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm lg:w-full ${
                  active ? "bg-signal/15 font-medium text-signal" : "text-muted hover:bg-panel hover:text-foreground"
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal`}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
                {item.id === "requests" ? (
                  <span className="ml-auto rounded-md bg-panel-raised px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
                    {pendingCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="grid min-w-0 gap-4">
        {view === "members" ? (
          <MembersPanel
            members={state.members}
            me={state.me}
            mock={mock}
            commander={commander}
            menu={menu}
            onMenu={setMenu}
            onAdd={addMember}
            onOpen={openView}
          />
        ) : null}
        {view === "invites" ? <InvitesPanel commander={commander} /> : null}
        {view === "roles" ? <RolesPanel /> : null}
        {view === "requests" ? (
          <RequestsPanel commander={commander} members={state.members} me={state.me} />
        ) : null}
      </div>
    </div>
  );
}

function MembersPanel({
  members,
  me,
  mock,
  commander,
  menu,
  onMenu,
  onAdd,
  onOpen,
}: {
  members: readonly MemberView[];
  me: MemberView | null;
  mock: boolean;
  commander: boolean;
  menu: boolean;
  onMenu: (open: boolean) => void;
  onAdd: () => void;
  onOpen: (view: PeopleView) => void;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | Role>("all");
  const [status, setStatus] = useState<StateFilter>("all");
  const [access, setAccess] = useState<AccessFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // Replace device results live here, not in the row: with the Status filter on Active the row
  // disappears the moment the revoke lands, and the new invite must still be shown.
  const [outcome, setOutcome] = useState<ReplaceOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const onReplaceOutcome = (next: ReplaceOutcome) => {
    setCopied(false);
    setOutcome(next);
  };

  const visible = members
    .filter((member) => matchesQuery(member, query))
    .filter((member) => role === "all" || member.role === role)
    .filter((member) => status === "all" || member.state === status)
    .filter((member) => access === "all" || accessLabel(member.role) === access)
    .slice()
    .sort(rosterOrder);

  return (
    <>
      {outcome?.kind === "invite" ? (
        <ReissuedInvite invite={outcome.invite} copied={copied} onCopied={setCopied} onDismiss={() => setOutcome(null)} />
      ) : outcome?.kind === "notice" ? (
        <div className="grid gap-2">
          <FormStatus message={outcome.message} />
          <div>
            <button type="button" onClick={() => setOutcome(null)} className={secondaryButtonClass}>
              Done
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Users aria-hidden="true" className="mt-1 size-7 shrink-0 text-foreground" />
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">Members</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
              Manage people, roles, and access for this incident room.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {commander ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-signal px-3.5 text-sm font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add member
            </button>
          ) : null}
          <div className="relative">
            <button
              type="button"
              aria-expanded={menu}
              aria-haspopup="menu"
              aria-label="More actions"
              onClick={() => onMenu(!menu)}
              className="grid size-10 place-items-center rounded-lg border border-line text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
            {menu ? (
              <div role="menu" className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-line bg-panel p-1">
                {commander ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onOpen("invites")}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-raised"
                  >
                    Invites and paging
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpen("requests")}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-raised"
                >
                  Access requests
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpen("roles")}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-raised"
                >
                  Roles
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ImHereButton />
      <PagingStatus />

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:min-w-56 sm:flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members..."
            aria-label="Search members"
            autoComplete="off"
            className="h-10 w-full rounded-full border border-line bg-panel pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
        </div>
        <FilterSelect
          label="Member rank"
          value={role}
          onChange={(value) => {
            if (value === "all" || isRole(value)) setRole(value);
          }}
        >
          <option value="all">Role</option>
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABELS[item]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={(value) => {
            if (isStateFilter(value)) setStatus(value);
          }}
        >
          <option value="all">Status</option>
          <option value="active">{memberStateLabel("active")}</option>
          <option value="pending">{memberStateLabel("pending")}</option>
          <option value="revoked">{memberStateLabel("revoked")}</option>
        </FilterSelect>
        <FilterSelect
          label="Filter by access"
          value={access}
          onChange={(value) => {
            if (isAccessFilter(value)) setAccess(value);
          }}
        >
          <option value="all">Access</option>
          <option value="Full access">Full access</option>
          <option value="No privileged">No privileged</option>
          <option value="No technical">No technical</option>
        </FilterSelect>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-line px-4 py-6 text-sm text-muted">No members match.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Member
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Access
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Joined
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((member) => {
                  const rowId = member.memberId.toString();
                  const open = openId === rowId;
                  return (
                    <MemberRows
                      key={rowId}
                      member={member}
                      mock={mock}
                      open={open}
                      onToggle={() => setOpenId(open ? null : rowId)}
                      onReplaceOutcome={onReplaceOutcome}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line md:hidden">
            {visible.map((member) => {
              const rowId = member.memberId.toString();
              const open = openId === rowId;
              return (
                <li key={rowId} className="grid gap-3 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <PersonCell member={member} />
                    <DetailsButton member={member} open={open} onToggle={() => setOpenId(open ? null : rowId)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RolePill role={member.role} />
                    <AccessPill role={member.role} />
                    <StatusMark member={member} />
                  </div>
                  <p className="text-xs text-muted">
                    Joined <LocalTime value={member.joinedAt} />
                  </p>
                  {open ? (
                    <>
                      <MemberFacts member={member} mock={mock} />
                      <RevokeControl member={member} onReplaceOutcome={onReplaceOutcome} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {commander && me && members.some((member) => member.state === "pending") ? (
        <AdmissionControls members={members.slice()} me={me} />
      ) : null}
      {commander ? (
        <AccessControls showAdmission={false} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-line bg-panel p-5">
            <h2 className="text-base font-semibold tracking-tight">Invite people</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Invites and admission are limited to the commander.</p>
          </section>
          <RoomAccessCard />
        </div>
      )}
    </>
  );
}

function MemberRows({
  member,
  mock,
  open,
  onToggle,
  onReplaceOutcome,
}: {
  member: MemberView;
  mock: boolean;
  open: boolean;
  onToggle: () => void;
  onReplaceOutcome: (outcome: ReplaceOutcome) => void;
}) {
  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3">
          <PersonCell member={member} />
        </td>
        <td className="px-3 py-3">
          <RolePill role={member.role} />
        </td>
        <td className="px-3 py-3">
          <AccessPill role={member.role} />
        </td>
        <td className="px-3 py-3">
          <StatusMark member={member} />
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
          <LocalTime value={member.joinedAt} />
        </td>
        <td className="px-3 py-3 text-right">
          <DetailsButton member={member} open={open} onToggle={onToggle} />
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line last:border-0">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid gap-3">
              <MemberFacts member={member} mock={mock} />
              <RevokeControl member={member} onReplaceOutcome={onReplaceOutcome} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailsButton({ member, open, onToggle }: { member: MemberView; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Details for ${member.displayName}`}
      onClick={onToggle}
      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <MoreHorizontal aria-hidden="true" className="size-4" />
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex shrink-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={filterClass}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </label>
  );
}

function InvitesPanel({ commander }: { commander: boolean }) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex items-start gap-3">
        <Mail aria-hidden="true" className="mt-1 size-7 shrink-0 text-foreground" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Invites</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
            Time-limited links for people outside the roster, and phone pages for people already on it.
          </p>
        </div>
      </div>
      {commander ? (
        <>
          <InviteControls />
          <PagePicker />
          <PagingStatus />
        </>
      ) : (
        <p className="text-sm text-muted">Invites and roster paging are limited to the commander.</p>
      )}
    </div>
  );
}

function RolesPanel() {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex items-start gap-3">
        <Shield aria-hidden="true" className="mt-1 size-7 shrink-0 text-foreground" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Roles</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
            A role decides which channels a person can read and which ones they can write. Invites cannot create a
            commander.
          </p>
        </div>
      </div>
      <ul className="grid gap-3">
        {ROLES.map((role) => (
          <li key={role} className="rounded-xl border border-line bg-panel px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{ROLE_LABELS[role]}</p>
              <AccessPill role={role} />
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Can read {channelPhrase(role, READ)}.</p>
            <p className="text-sm leading-6 text-muted">Can write {channelPhrase(role, WRITE)}.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestsPanel({
  commander,
  members,
  me,
}: {
  commander: boolean;
  members: MemberView[];
  me: MemberView | null;
}) {
  const pending = members.filter((member) => member.state === "pending");
  if (commander && me) return <AdmissionControls members={members} me={me} />;
  return (
    <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="requests-heading">
      <h2 id="requests-heading" className="text-base font-semibold tracking-tight">
        Access requests
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">Admission is limited to the commander.</p>
      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No one is waiting for admission.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {pending.map((member) => (
            <li key={member.memberId.toString()} className="text-sm">
              <SafeText text={member.displayName} />
              <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
