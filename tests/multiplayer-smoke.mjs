import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const httpOrigin = process.argv[2] || "http://127.0.0.1:8787";
const wsOrigin = httpOrigin.replace(/^http/, "ws");

class SocketProbe {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.waiters = [];
    this.ws.addEventListener("message", (event) => {
      const value = JSON.parse(String(event.data));
      this.messages.push(value);
      this.flush();
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket open timeout")), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket open error"));
      }, { once: true });
    });
  }

  send(value) {
    this.ws.send(JSON.stringify(value));
  }

  next(predicate, label = "message") {
    const found = this.messages.findIndex(predicate);
    if (found >= 0) return Promise.resolve(this.messages.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      this.waiters.push(waiter);
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        reject(new Error(`Timed out waiting for ${label}`));
      }, 7000);
    });
  }

  flush() {
    for (const waiter of [...this.waiters]) {
      const found = this.messages.findIndex(waiter.predicate);
      if (found < 0) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
      waiter.resolve(this.messages.splice(found, 1)[0]);
    }
  }

  close() {
    if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(1000, "test_complete");
  }
}

const clientA = randomUUID();
const clientB = randomUUID();
const matchA = new SocketProbe(`${wsOrigin}/api/match?client=${clientA}`);
const matchB = new SocketProbe(`${wsOrigin}/api/match?client=${clientB}`);
await Promise.all([matchA.open(), matchB.open()]);
const [matchedA, matchedB] = await Promise.all([
  matchA.next((message) => message.type === "matched", "match A"),
  matchB.next((message) => message.type === "matched", "match B")
]);
assert.match(matchedA.room, /^[A-Z2-9]{8}$/);
assert.equal(matchedA.room, matchedB.room);
const room = matchedA.room;

const before = await fetch(`${httpOrigin}/api/conventions`).then((response) => response.json());

let playerA = new SocketProbe(`${wsOrigin}/api/room/${room}?client=${clientA}`);
let playerB = new SocketProbe(`${wsOrigin}/api/room/${room}?client=${clientB}`);
await Promise.all([playerA.open(), playerB.open()]);

for (let round = 1; round <= 12; round += 1) {
  const [stateA, stateB] = await Promise.all([
    playerA.next(
      (message) => message.type === "state" && message.round === round && message.phase === "signal",
      `round ${round} signal state A`
    ),
    playerB.next(
      (message) => message.type === "state" && message.round === round && message.phase === "signal",
      `round ${round} signal state B`
    )
  ]);
  const senderProbe = stateA.role === "sender" ? playerA : playerB;
  const receiverProbe = stateA.role === "receiver" ? playerA : playerB;
  const senderState = stateA.role === "sender" ? stateA : stateB;

  if (round === 1) {
    const intruder = new SocketProbe(
      `${wsOrigin}/api/room/${room}?client=${randomUUID()}`
    );
    await intruder.open();
    const full = await intruder.next(
      (message) => message.type === "error",
      "room-full rejection"
    );
    assert.equal(full.code, "room_full");
    intruder.close();

    receiverProbe.send({ type: "signal", value: 0 });
    const error = await receiverProbe.next(
      (message) => message.type === "error",
      "unauthorized signal rejection"
    );
    assert.equal(error.code, "signal_not_allowed");
  }

  senderProbe.send({ type: "signal", value: senderState.target });
  const [guessA, guessB] = await Promise.all([
    playerA.next(
      (message) => message.type === "state" && message.round === round && message.phase === "guess",
      `round ${round} guess state A`
    ),
    playerB.next(
      (message) => message.type === "state" && message.round === round && message.phase === "guess",
      `round ${round} guess state B`
    )
  ]);
  const receiverState = guessA.role === "receiver" ? guessA : guessB;
  assert.equal(receiverState.target, null, "receiver must not see the target before guessing");
  assert.equal(receiverState.signal, senderState.target);
  receiverProbe.send({ type: "guess", value: senderState.target });

  const finalPhase = round === 12 ? "finished" : "result";
  const [resultA, resultB] = await Promise.all([
    playerA.next(
      (message) => message.type === "state" && message.round === round && message.phase === finalPhase,
      `round ${round} result state A`
    ),
    playerB.next(
      (message) => message.type === "state" && message.round === round && message.phase === finalPhase,
      `round ${round} result state B`
    )
  ]);
  assert.equal(resultA.result.correct, true);
  assert.equal(resultB.score, round);

  if (round < 12) {
    if (round === 1) {
      playerB.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      playerB = new SocketProbe(`${wsOrigin}/api/room/${room}?client=${clientB}`);
      await playerB.open();
      const restored = await playerB.next(
        (message) =>
          message.type === "state" &&
          message.round === 1 &&
          message.phase === "result",
        "reconnected player state"
      );
      assert.equal(restored.result.correct, true);
      assert.equal(restored.score, 1);
    }
    playerA.send({ type: "ready" });
    playerB.send({ type: "ready" });
  }
}

let after = before;
for (let attempt = 0; attempt < 20; attempt += 1) {
  after = await fetch(`${httpOrigin}/api/conventions`).then((response) => response.json());
  if (after.total === before.total + 1) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(after.total, before.total + 1, "completed room should submit exactly once");

playerA.close();
playerB.close();
matchA.close();
matchB.close();
console.log(JSON.stringify({
  ok: true,
  room,
  rounds: 12,
  successfulRounds: 12,
  aggregateBefore: before.total,
  aggregateAfter: after.total
}));
