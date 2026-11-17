import { assert, expect, it } from "@effect/vitest";
import type { RunDetail } from "@t3-factory/contracts";
import { remotePrepared, remoteServer } from "./support/remote-clients.ts";

it("a Start whose response was lost resolves to the original Run when the client retries it", async (c) => {
  // Arrange
  const { server, laptop, input } = await remotePrepared(c);
  await laptop.sendLosingResponse("POST", "/api/runs", input);

  // Act
  const retried = await laptop.send<RunDetail>("POST", "/api/runs", input);

  // Assert
  assert(retried.body.ok);
  const runs = await server.factory.listRuns(input.projectId);
  assert(runs.ok);
  expect(runs.value.map((run) => run.id)).toStrictEqual([retried.body.value.id]);
});

it("concurrent edits from two approved clients keep revision conflicts", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const laptop = await server.approved("Laptop");
  const browser = await server.approved("Browser profile", "browser");
  const created = await server.factory.createFlow({ name: "Shared plan" });
  assert(created.ok);
  const edit = (name: string) => ({
    name,
    expectedRevision: 1,
    expectedProjectId: null,
    graph: created.value.graph,
  });
  assert((await laptop.send("PUT", `/api/flows/${created.value.id}`, edit("Laptop edit"))).body.ok);

  // Act
  const reply = await browser.send("PUT", `/api/flows/${created.value.id}`, edit("Browser edit"));

  // Assert
  expect(reply.status).toBe(409);
  const saved = await server.factory.getFlow(created.value.id);
  assert(saved.ok);
  expect(saved.value.name).toBe("Laptop edit");
});

it("a client saving a Flow without a workspace keeps the saved workspace", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const laptop = await server.approved("Laptop");
  const created = await server.factory.createFlow({ name: "Shared plan" });
  assert(created.ok);
  const checkout = await server.factory.updateFlow(created.value.id, {
    name: created.value.name,
    expectedRevision: 1,
    expectedProjectId: null,
    workspace: { mode: "checkout" },
    graph: created.value.graph,
  });
  assert(checkout.ok);

  // Act
  const reply = await laptop.send("PUT", `/api/flows/${created.value.id}`, {
    name: "Laptop edit",
    expectedRevision: 2,
    expectedProjectId: null,
    graph: created.value.graph,
  });

  // Assert
  expect(reply.status).toBe(200);
  expect(await server.factory.getFlow(created.value.id)).toMatchObject({
    ok: true,
    value: { revision: 3, name: "Laptop edit", workspace: { mode: "checkout" } },
  });
});

it("a protocol 16 client, which cannot validate a Flow under its owning Project, is told to update itself while the current client is served", async (c) => {
  // Arrange
  const server = await remoteServer(c);
  const current = await server.approved("Laptop");
  assert((await current.send("GET", "/api/flows")).body.ok);
  const old = server.client("desktop", { protocol: 16, minimum: 16 });

  // Act
  const reply = await old.send("GET", "/api/flows");

  // Assert
  expect(reply.status).toBe(426);
  assert(!reply.body.ok);
  expect(reply.body.error.message).toMatch(/Update this client/);
});

const serverUpdate = {
  status: 426,
  body: { ok: false, error: { message: expect.stringMatching(/Update the Factory server/) } },
} as const;

it.for([
  [16, serverUpdate],
  [17, serverUpdate],
  [18, { status: 200, body: { ok: true, value: { scope: "remote" } } }],
] as const)(
  "the current client, which manages Triggers, refuses a protocol %i server only when it predates 18",
  async ([protocol, expected], c) => {
    // Arrange
    const server = await remoteServer(c, { protocol: { protocol, minimumPeerProtocol: 9 } });
    const current = server.client();

    // Act
    const reply = await current.send("GET", "/api/client-access");

    // Assert
    expect(reply).toMatchObject(expected);
  },
);
