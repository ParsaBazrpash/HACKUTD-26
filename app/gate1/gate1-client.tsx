'use client';

import { useMemo } from 'react';
import { SpacetimeDBProvider, useReducer, useTable } from 'spacetimedb/react';
import { DbConnection, reducers, tables } from '@/src/module_bindings';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
const DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? 'zerohour-hackutd26';
const TOKEN_KEY = 'zh-gate1-token';

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function Pings() {
  const [rows, ready] = useTable(tables.ping);
  const addPing = useReducer(reducers.addPing);
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Gate 1: live sync</h1>
      <p>{ready ? 'connected' : 'connecting'}: {rows.length} pings</p>
      <button type="button" onClick={() => void addPing()}>
        Add ping
      </button>
      <ul>
        {rows.map((r) => (
          <li key={String(r.id)}>
            #{String(r.id)} from {r.sender.toHexString().slice(0, 8)} at {r.at.toDate().toISOString()}
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function Gate1Client() {
  const builder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(readToken())
        .onConnect((conn, _identity, token) => {
          try {
            localStorage.setItem(TOKEN_KEY, token);
          } catch {
            /* storage may be unavailable */
          }
          conn.subscriptionBuilder().subscribe(tables.ping);
        })
        .onConnectError((_ctx, err) => console.error('connect error', err.message)),
    [],
  );
  return (
    <SpacetimeDBProvider connectionBuilder={builder}>
      <Pings />
    </SpacetimeDBProvider>
  );
}
