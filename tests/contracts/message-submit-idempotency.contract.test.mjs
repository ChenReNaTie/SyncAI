import test from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import { expectRouteImplemented } from "../helpers/contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_message_submit_idempotency");

test(`${group.id} exposes message submission with client_message_id idempotency semantics`, async () => {
  await withInjectedApp(async (app) => {
    await expectRouteImplemented(
      app,
      {
        method: "POST",
        url: "/api/v1/sessions/session-under-test/messages",
        payload: {
          content: "Drive the same Codex session forward",
          client_message_id: "web-1744680000-001",
        },
      },
      group,
    );
  });
});
