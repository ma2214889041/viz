import { DurableObject } from "cloudflare:workers";

const TOKENS = ["mepo", "luma", "tavi"] as const;
const OBJECTS = ["circle", "triangle", "square"] as const;
const MAX_ROUNDS = 12;
const ROOM_PATTERN = /^[A-Z2-9]{8}$/;
const CLIENT_PATTERN = /^[a-f0-9-]{16,64}$/i;

type Phase = "waiting" | "signal" | "guess" | "result" | "finished";

interface Env {
  ASSETS: Fetcher;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  LANGUAGE_ROOM: DurableObjectNamespace<LanguageRoom>;
  CONVENTION_AGGREGATE: DurableObjectNamespace<ConventionAggregate>;
}

interface SocketAttachment {
  clientId: string;
  joinedAt: number;
}

interface MatchAttachment extends SocketAttachment {
  status: "waiting" | "matched";
}

interface GameResult {
  target: number;
  signal: number;
  guess: number;
  correct: boolean;
}

interface GameState {
  version: 1;
  players: string[];
  round: number;
  score: number;
  phase: Phase;
  senderIndex: number;
  target: number | null;
  signal: number | null;
  result: GameResult | null;
  ready: string[];
  uses: number[][];
  successes: number[][];
  submitted: boolean;
}

type ClientMessage =
  | { type: "signal"; value: number }
  | { type: "guess"; value: number }
  | { type: "ready" }
  | { type: "reset" };

const emptyMatrix = () => Array.from({ length: 3 }, () => [0, 0, 0]);

const freshState = (players: string[] = []): GameState => ({
  version: 1,
  players,
  round: 0,
  score: 0,
  phase: "waiting",
  senderIndex: 0,
  target: null,
  signal: null,
  result: null,
  ready: [],
  uses: emptyMatrix(),
  successes: emptyMatrix(),
  submitted: false
});

const randomInt = (upper: number) => {
  const limit = Math.floor(0x100000000 / upper) * upper;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0] >= limit);
  return value[0] % upper;
};

const randomRoomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers
    }
  });

const websocketResponse = (client: WebSocket) =>
  new Response(null, { status: 101, webSocket: client });

const parseClientId = (request: Request) => {
  const clientId = new URL(request.url).searchParams.get("client") || "";
  return CLIENT_PATTERN.test(clientId) ? clientId : null;
};

const isWebSocketUpgrade = (request: Request) =>
  request.headers.get("Upgrade")?.toLowerCase() === "websocket";

export class Matchmaker extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const clientId = parseClientId(request);
    if (!clientId) return json({ error: "invalid_client" }, 400);
    if (!isWebSocketUpgrade(request)) return json({ error: "websocket_required" }, 426);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: MatchAttachment = {
      clientId,
      joinedAt: Date.now(),
      status: "waiting"
    };

    const duplicate = this.ctx.getWebSockets().find((socket) => {
      const data = socket.deserializeAttachment() as MatchAttachment | null;
      return data?.clientId === clientId;
    });
    if (duplicate) duplicate.close(4001, "replaced");

    this.ctx.acceptWebSocket(server, ["waiting"]);
    server.serializeAttachment(attachment);

    const peer = this.ctx.getWebSockets("waiting").find((socket) => {
      if (socket === server) return false;
      const data = socket.deserializeAttachment() as MatchAttachment | null;
      return data?.status === "waiting";
    });
    if (!peer) {
      server.send(JSON.stringify({ type: "queued" }));
      return websocketResponse(client);
    }

    const room = randomRoomCode();
    const matched = JSON.stringify({ type: "matched", room });
    const peerAttachment = peer.deserializeAttachment() as MatchAttachment;
    peer.serializeAttachment({ ...peerAttachment, status: "matched" });
    server.serializeAttachment({ ...attachment, status: "matched" });
    peer.send(matched);
    server.send(matched);
    return websocketResponse(client);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "cancel") {
      ws.close(1000, "cancelled");
    }
  }

  webSocketClose(): void {}

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "matchmaker_error");
  }
}

export class ConventionAggregate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        room_hash TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS totals (
        category TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const rows = [...this.ctx.storage.sql.exec<{ category: string; count: number }>(
        "SELECT category, count FROM totals ORDER BY category"
      )];
      const counts = Object.fromEntries(rows.map(({ category, count }) => [category, count]));
      return json({ total: rows.reduce((sum, row) => sum + row.count, 0), counts });
    }

    if (request.method !== "POST" || url.pathname !== "/submit") {
      return json({ error: "not_found" }, 404);
    }

    const body = (await request.json()) as { roomCode?: unknown; category?: unknown };
    if (
      typeof body.roomCode !== "string" ||
      !ROOM_PATTERN.test(body.roomCode) ||
      typeof body.category !== "string" ||
      !/^(?:[012]{3}|unsettled)$/.test(body.category)
    ) {
      return json({ error: "invalid_submission" }, 400);
    }

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body.roomCode)
    );
    const roomHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO submissions (room_hash, category, created_at) VALUES (?, ?, ?)",
      roomHash,
      body.category,
      Date.now()
    );
    const changed = [...this.ctx.storage.sql.exec<{ changed: number }>(
      "SELECT changes() AS changed"
    )][0]?.changed;
    if (changed === 1) {
      this.ctx.storage.sql.exec(
        `INSERT INTO totals (category, count) VALUES (?, 1)
         ON CONFLICT(category) DO UPDATE SET count = count + 1`,
        body.category
      );
    }
    return json({ accepted: changed === 1 });
  }
}

export class LanguageRoom extends DurableObject<Env> {
  private state: GameState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS game_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT NOT NULL
      )
    `);
    const row = [...this.ctx.storage.sql.exec<{ value: string }>(
      "SELECT value FROM game_state WHERE id = 1"
    )][0];
    this.state = row ? (JSON.parse(row.value) as GameState) : freshState();
    if (!row) this.persist();
  }

  async fetch(request: Request): Promise<Response> {
    const clientId = parseClientId(request);
    if (!clientId) return json({ error: "invalid_client" }, 400);
    if (!isWebSocketUpgrade(request)) return json({ error: "websocket_required" }, 426);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = { clientId, joinedAt: Date.now() };

    for (const socket of this.ctx.getWebSockets()) {
      const data = socket.deserializeAttachment() as SocketAttachment | null;
      if (data?.clientId === clientId) socket.close(4001, "replaced");
    }

    const connected = new Set(
      this.ctx
        .getWebSockets()
        .map((socket) => (socket.deserializeAttachment() as SocketAttachment | null)?.clientId)
        .filter((id): id is string => Boolean(id))
    );

    let resetPair = false;
    if (!this.state.players.includes(clientId)) {
      if (this.state.players.length < 2) {
        this.state.players.push(clientId);
      } else {
        const absentIndex = this.state.players.findIndex((id) => !connected.has(id));
        if (absentIndex < 0) {
          this.ctx.acceptWebSocket(server);
          server.serializeAttachment(attachment);
          server.send(JSON.stringify({ type: "error", code: "room_full" }));
          server.close(4003, "room_full");
          return websocketResponse(client);
        }
        const remaining = this.state.players.filter((_, index) => index !== absentIndex);
        this.state = freshState([...remaining, clientId]);
        resetPair = true;
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    if (this.state.players.length === 2 && (this.state.phase === "waiting" || resetPair)) {
      this.startRound();
    } else {
      this.persist();
    }
    this.broadcast();
    return websocketResponse(client);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || typeof raw !== "string") return this.sendError(ws, "invalid_message");

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.sendError(ws, "invalid_json");
    }

    const clientId = attachment.clientId;
    if (!this.state.players.includes(clientId)) return this.sendError(ws, "not_a_player");

    if (message.type === "reset") {
      if (this.state.phase !== "finished") return this.sendError(ws, "reset_not_available");
      this.state = freshState([...this.state.players]);
      this.startRound();
      this.broadcast();
      return;
    }

    const senderId = this.state.players[this.state.senderIndex];
    const receiverId = this.state.players[1 - this.state.senderIndex];

    if (message.type === "signal") {
      if (
        this.state.phase !== "signal" ||
        clientId !== senderId ||
        !Number.isInteger(message.value) ||
        message.value < 0 ||
        message.value >= TOKENS.length
      ) {
        return this.sendError(ws, "signal_not_allowed");
      }
      this.state.signal = message.value;
      this.state.phase = "guess";
      this.persist();
      this.broadcast();
      return;
    }

    if (message.type === "guess") {
      if (
        this.state.phase !== "guess" ||
        clientId !== receiverId ||
        this.state.target === null ||
        this.state.signal === null ||
        !Number.isInteger(message.value) ||
        message.value < 0 ||
        message.value >= OBJECTS.length
      ) {
        return this.sendError(ws, "guess_not_allowed");
      }
      const correct = message.value === this.state.target;
      const result: GameResult = {
        target: this.state.target,
        signal: this.state.signal,
        guess: message.value,
        correct
      };
      this.state.result = result;
      this.state.uses[result.signal][result.target] += 1;
      if (correct) {
        this.state.score += 1;
        this.state.successes[result.signal][result.target] += 1;
      }
      this.state.ready = [];
      this.state.phase = this.state.round >= MAX_ROUNDS ? "finished" : "result";
      this.persist();
      this.broadcast();
      if (this.state.phase === "finished" && !this.state.submitted) {
        await this.submitConvention();
      }
      return;
    }

    if (message.type === "ready") {
      if (this.state.phase !== "result") return this.sendError(ws, "ready_not_allowed");
      if (!this.state.ready.includes(clientId)) this.state.ready.push(clientId);
      if (this.state.ready.length === 2) this.startRound();
      else this.persist();
      this.broadcast();
      return;
    }

    this.sendError(ws, "unknown_message");
  }

  webSocketClose(): void {
    this.broadcast();
  }

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "room_error");
    this.broadcast();
  }

  private startRound(): void {
    if (this.state.players.length !== 2) return;
    this.state.round += 1;
    this.state.senderIndex = (this.state.round - 1) % 2;
    this.state.target = randomInt(OBJECTS.length);
    this.state.signal = null;
    this.state.result = null;
    this.state.ready = [];
    this.state.phase = "signal";
    this.persist();
  }

  private persist(): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO game_state (id, value) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
      JSON.stringify(this.state)
    );
  }

  private sendError(ws: WebSocket, code: string): void {
    ws.send(JSON.stringify({ type: "error", code }));
  }

  private connectedIds(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .map((socket) => (socket.deserializeAttachment() as SocketAttachment | null)?.clientId)
        .filter((id): id is string => Boolean(id))
    );
  }

  private viewFor(clientId: string) {
    const playerIndex = this.state.players.indexOf(clientId);
    const senderId = this.state.players[this.state.senderIndex];
    const isSender = clientId === senderId;
    const connected = this.connectedIds();
    const revealTarget =
      (isSender && (this.state.phase === "signal" || this.state.phase === "guess")) ||
      this.state.phase === "result" ||
      this.state.phase === "finished";

    return {
      type: "state",
      phase: this.state.phase,
      round: this.state.round,
      maxRounds: MAX_ROUNDS,
      score: this.state.score,
      role: playerIndex < 0 ? null : isSender ? "sender" : "receiver",
      target: revealTarget ? this.state.target : null,
      signal: this.state.phase === "signal" && !isSender ? null : this.state.signal,
      result: this.state.result,
      ready: this.state.ready.includes(clientId),
      readyCount: this.state.ready.length,
      uses: this.state.uses,
      successes: this.state.successes,
      players: this.state.players.length,
      connected: this.state.players.map((id) => connected.has(id)),
      tokens: TOKENS,
      objects: OBJECTS
    };
  }

  private broadcast(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      try {
        socket.send(JSON.stringify(this.viewFor(attachment.clientId)));
      } catch {
        // A closing socket can disappear between getWebSockets() and send().
      }
    }
  }

  private conventionCategory(): string {
    const mapping = this.state.uses.map((row) => {
      const max = Math.max(...row);
      const winners = row.flatMap((value, index) => (value === max && max > 0 ? [index] : []));
      return winners.length === 1 ? winners[0] : -1;
    });
    return mapping.every((value) => value >= 0) && new Set(mapping).size === 3
      ? mapping.join("")
      : "unsettled";
  }

  private async submitConvention(): Promise<void> {
    const roomCode = this.ctx.id.name;
    if (!roomCode || !ROOM_PATTERN.test(roomCode)) return;
    const response = await this.env.CONVENTION_AGGREGATE.getByName("global").fetch(
      "https://aggregate.internal/submit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomCode,
          category: this.conventionCategory()
        })
      }
    );
    if (response.ok) {
      this.state.submitted = true;
      this.persist();
    }
  }
}

const routeRoom = (pathname: string) => {
  const match = pathname.match(/^\/api\/room\/([A-Z2-9]{8})$/);
  return match?.[1] || null;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "viz-language-game", version: 1 });
    }

    if (url.pathname === "/api/match") {
      return env.MATCHMAKER.getByName("global").fetch(request);
    }

    const roomCode = routeRoom(url.pathname);
    if (roomCode) {
      return env.LANGUAGE_ROOM.getByName(roomCode).fetch(request);
    }

    if (url.pathname === "/api/conventions") {
      return env.CONVENTION_AGGREGATE.getByName("global").fetch(
        new Request("https://aggregate.internal/", { method: "GET" })
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
