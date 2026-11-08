"use client";

import { BlastRadius } from "@/components/incidents/blast-radius";
import { scopeStatusLabel } from "@/components/incidents/labels";
import { ScopeForm } from "@/components/incidents/scope-form";
import { ScopeList } from "@/components/incidents/scope-list";
import { exposedScope, groupScope } from "@/components/incidents/situation";
import { useIncident } from "@/hooks/use-incident";

export function SystemsBoard() {
  const state = useIncident();
  const groups = groupScope(state.scope);
  const exposed = exposedScope(state.scope);

  return (
    <div className="grid min-w-0 gap-8">
      <BlastRadius />
      <div>
        <h2 className="text-xl font-medium tracking-tight">Affected systems</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {state.scope.length} systems on the record. {exposed.length} are still in the blast radius: suspected,
          encrypted, or exfiltrated.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">No systems recorded yet.</p>
      ) : (
        <div className="grid gap-8">
          {groups.map((group) => (
            <section key={group.status} aria-labelledby={`scope-${group.status}`}>
              <h3 id={`scope-${group.status}`} className="text-sm font-medium">
                {scopeStatusLabel(group.status)}
                <span className="text-muted"> · {group.items.length}</span>
              </h3>
              <div className="mt-3">
                <ScopeList items={group.items} />
              </div>
            </section>
          ))}
        </div>
      )}
      <ScopeForm />
    </div>
  );
}
