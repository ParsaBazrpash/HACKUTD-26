# Integrity failure reasons: what the UI can show

For Lane B (the red banner, the integrity panel, the lock screen). Every string and code below comes from `lib/crypto/verify.ts` and `lib/client/real.ts` as of main. The types are in `lib/client/types.ts` (`FailureReason`, `WarningReason`, `IntegrityReport`).

## Where to read it

`useIncident().integrity` is an `IntegrityReport`:

- `ok`: false when any channel failed or any roster check failed.
- `channels[kind]`: one `ChannelIntegrity` per readable channel, with `failures: { seq, reason, detail? }[]`, `head`, `pinnedOk`, `waitingForKeys` and `latestCheckpoint`.
- `rosterFailures: { identity, reason }[]`.

Each event also carries its own `verdict` (`ok`, `failures`, `warnings`). A failing event is kept and flagged, never hidden.

## Suggested banner text

Banner headline: `Integrity failure: #<channel> seq <seq>`. Use the first failure of the first failing channel. Then show the plain-language line below.

| `reason` | Plain-language line | Typical cause | `detail` strings you may see |
|---|---|---|---|
| `bad_signature` | The author's signature does not match this entry. | The entry was changed, or forged by the server. | none |
| `cannot_decrypt` | This entry was altered; it no longer decrypts. | The stored bytes were edited. This is what an owner `UPDATE` of a ciphertext produces. | none |
| `chain_broken` | The chain of entries was cut or rewritten at this point. | An entry was edited, inserted, or its hash or link changed. | `duplicate seq`, `prevHash does not match previous event`, `stored hash does not match recomputed hash`, `channel head hash mismatch` |
| `gap` | Entries are missing before this one. | The server hid or deleted entries. | `expected seq N`, `first delivered event is not seq 1`, `server reports events that were not delivered` |
| `history_rewritten` | The history no longer matches what this device or the commander saw before. | Rollback, truncation, or a rebuilt chain. | `pinned event is missing (rollback)`, `event hash differs from the pinned hash`, `events before a signed checkpoint are missing (truncation)`, `event hash differs from the commander-signed checkpoint`, `checkpoint signature does not verify under the commander key` |
| `unknown_author` | The author was never admitted by the commander. | Forged or injected entry. | none |
| `revoked_author` | The author had already been revoked when this was written. | A revoked device kept posting, or timestamps were altered. | none |
| `not_permitted` | The author's role may not write this here. | Role or channel policy violated. | `role cannot write this channel`, `<kind> not allowed for <role> in #<channel>` |
| `replay` | A duplicate or out-of-order entry was inserted. | Replayed entry or lowered author counter. | `duplicate event id`, `author counter did not increase` |
| `stale_epoch` | Written with an old key after the keys had changed. | Post-revocation replay with an old epoch key. | none |
| `invalid_payload` | The entry decrypted but its content is malformed. | Buggy or hostile client. | none |
| `unknown_kind` | The entry type is not known to this version. | Newer client, or tampering. | none |

Where to place `history_rewritten` in the UI: it is the strongest signal. Show it first when present.

## Warnings (amber, not red)

| `warning` | Meaning | Does it turn the report red? |
|---|---|---|
| `clock_drift` | The author's own timestamp differs from the server's by more than 5 minutes. Show both times. | No |
| `waiting_for_keys` | The entry cannot be read yet because the key has not arrived (for example a newly admitted member). `ChannelIntegrity.waitingForKeys` is true. | No |

## Roster failures (`rosterFailures[].reason`)

| String | Meaning |
|---|---|
| `missing or invalid admission certificate` | A member row has no valid commander signature. Do not trust that member. |
| `commander keys do not match the pinned keys` | The server presented different keys for the commander than the invite pinned. Strongest possible warning. |
| `invalid revocation signature` | A revocation that the commander did not sign. The member is treated as still active. |
| `revocation has no time` | Server data is inconsistent. |
| `pinned commander key invalid` | Local pin is corrupt. |
| `unknown role` | A member row has a role this version does not know. |

## Checkpoints

`channels[kind].latestCheckpoint` is `{ seq, hashHex, verified }`. Show "Checkpoint at seq N, signed by the commander" when `verified` is true. When it is false the channel is also red with `history_rewritten`. The commander's client posts a checkpoint about every 10 events.

## Connection and action errors

`IncidentState.connection` is `connecting`, `ready`, `offline` or `error`. When it is `error`, `IncidentState.error` holds a safe message (never secrets). Messages the UI may show as inline errors from actions (they are all `ClientError.message`):

- Join and redeem: `This invite link is not valid`, `This invite link could not be used`, `This invite link could not be used. It may be expired or already used, or the name may be taken.`, `This is not the incident you were invited to`, `The server presented a different commander than the one you pinned`.
- Admit: `Unverified: do not admit. The join request does not match the invite link.`, `That member cannot be admitted`, `Could not admit the member`.
- Revoke: `That member cannot be revoked`, `Could not revoke the member`, `Cannot rotate keys: a member has no valid admission certificate`.
- Posting: `Your role cannot post this`, `Channel is not available`, `Waiting for channel keys`, `Could not send. Check your connection and try again.`
- General: `Only the commander can do this`, `You are not an active member of this incident`, `This device does not hold the keys for this incident`, `Not connected to the server`.

## Lock screen

When `me.state === 'revoked'`, the client has already wiped this device's keys and shows no channels or events. Render the lock screen from `me.state` alone.

## What each demo moment produces

- Owner edits a ciphertext in the database: `chain_broken`, `bad_signature` and `cannot_decrypt` at that seq on every reader whose role can read the channel (proven by `live/tamper.live.ts` and `lib/client/real.test.ts`).
- Server hides the last entries: `gap` with `server reports events that were not delivered`.
- Server rolls the chain back: `history_rewritten` with `pinned event is missing (rollback)` or `events before a signed checkpoint are missing (truncation)`.
- Commander revokes someone: the target sees the lock screen; everyone else stays green and the roster shows the member as revoked.
