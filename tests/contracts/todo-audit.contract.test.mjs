import test from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import { expectRouteImplemented } from "../helpers/contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_todo_and_audit");

const requests = [
  {
    method: "GET",
    url: "/api/v1/sessions/session-under-test/todos",
  },
  {
    method: "POST",
    url: "/api/v1/sessions/session-under-test/todos",
    payload: {
      source_message_id: "message-under-test",
      title: "Backfill the automation suite",
    },
  },
  {
    method: "PATCH",
    url: "/api/v1/todos/todo-under-test",
    payload: {
      status: "completed",
    },
  },
  {
    method: "GET",
    url: "/api/v1/sessions/session-under-test/audit-logs",
  },
];

for (const request of requests) {
  test(`${group.id} wires ${request.method} ${request.url}`, async () => {
    await withInjectedApp(async (app) => {
      await expectRouteImplemented(app, request, group);
    });
  });
}
