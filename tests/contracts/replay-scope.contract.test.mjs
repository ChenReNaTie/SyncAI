import test from "node:test";
import { getDocumentedGroup } from "../fixtures/requirements-map.mjs";
import { expectRouteImplemented } from "../helpers/contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

const group = getDocumentedGroup("contract_replay_scope");

test(`${group.id} exposes the replay endpoint described in the reviewed scripts`, async () => {
  await withInjectedApp(async (app) => {
    await expectRouteImplemented(
      app,
      {
        method: "GET",
        url: "/api/v1/sessions/session-under-test/replay",
      },
      group,
    );
  });
});
