import test from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import { expectRouteImplemented } from "../helpers/contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_session_create_visibility");

const requests = [
  {
    method: "POST",
    url: "/api/v1/projects/project-under-test/sessions",
    payload: {
      title: "Fix the queue state machine",
      visibility: "shared",
    },
  },
  {
    method: "GET",
    url: "/api/v1/projects/project-under-test/sessions",
  },
  {
    method: "GET",
    url: "/api/v1/sessions/session-under-test",
  },
  {
    method: "PATCH",
    url: "/api/v1/sessions/session-under-test/visibility",
    payload: {
      visibility: "private",
    },
  },
];

for (const request of requests) {
  test(`${group.id} wires ${request.method} ${request.url}`, async () => {
    await withInjectedApp(async (app) => {
      await expectRouteImplemented(app, request, group);
    });
  });
}
