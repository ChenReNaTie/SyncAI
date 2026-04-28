import assert from "node:assert/strict";
import test, { after } from "node:test";
import { closePool, getPool } from "../helpers/database.mjs";
import {
  assertAuthRequiredError,
  assertStrictKeys,
  assertUserContract,
} from "../helpers/http-contracts.mjs";
import { withInjectedApp } from "../helpers/server-app.mjs";

after(async () => {
  await closePool();
});

function assertJwtLikeToken(token) {
  assert.equal(typeof token, "string");
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
}

async function deleteUsersByEmail(emails) {
  if (emails.length === 0) {
    return;
  }

  await getPool().query(
    `DELETE FROM users
     WHERE email = ANY($1::text[])`,
    [emails],
  );
}

test("contract_auth_bootstrap registers a user and resolves the current actor from the returned access token", async () => {
  const email = `auth-register-${Date.now()}@example.com`;

  try {
    await withInjectedApp(async (app) => {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email,
          password: "StrongPass123",
          display_name: "Admin A",
        },
      });

      assert.equal(registerResponse.statusCode, 201);

      const registerPayload = registerResponse.json();
      assertStrictKeys(registerPayload, ["data"]);
      assertStrictKeys(registerPayload.data, [
        "access_token",
        "refresh_token",
        "user",
      ]);
      assertUserContract(registerPayload.data.user, {
        email,
        display_name: "Admin A",
      });
      assertJwtLikeToken(registerPayload.data.access_token);
      assertJwtLikeToken(registerPayload.data.refresh_token);

      const storedUser = await getPool().query(
        `SELECT password_hash
         FROM users
         WHERE id = $1`,
        [registerPayload.data.user.id],
      );

      assert.equal(storedUser.rowCount, 1);
      assert.notEqual(
        storedUser.rows[0].password_hash,
        "StrongPass123",
      );

      const meResponse = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: `Bearer ${registerPayload.data.access_token}`,
        },
      });

      assert.equal(meResponse.statusCode, 200);
      const mePayload = meResponse.json();
      assertStrictKeys(mePayload, ["data"]);
      assertUserContract(mePayload.data, {
        id: registerPayload.data.user.id,
        email,
        display_name: "Admin A",
      });
    });
  } finally {
    await deleteUsersByEmail([email]);
  }
});

test("contract_auth_bootstrap rejects duplicate registration, invalid credentials, and invalid current-user tokens", async () => {
  const email = `auth-login-${Date.now()}@example.com`;

  try {
    await withInjectedApp(async (app) => {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email,
          password: "StrongPass123",
          display_name: "Member A",
        },
      });

      assert.equal(registerResponse.statusCode, 201);
      const registerPayload = registerResponse.json();

      const duplicateResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email,
          password: "StrongPass123",
          display_name: "Member B",
        },
      });

      assert.equal(duplicateResponse.statusCode, 409);
      assert.deepEqual(duplicateResponse.json(), {
        code: "EMAIL_ALREADY_EXISTS",
      });

      const invalidLoginResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email,
          password: "WrongPass123",
        },
      });

      assert.equal(invalidLoginResponse.statusCode, 401);
      assert.deepEqual(invalidLoginResponse.json(), {
        code: "INVALID_CREDENTIALS",
      });

      const validLoginResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email,
          password: "StrongPass123",
        },
      });

      assert.equal(validLoginResponse.statusCode, 200);
      const validLoginPayload = validLoginResponse.json();
      assertStrictKeys(validLoginPayload, ["data"]);
      assertStrictKeys(validLoginPayload.data, [
        "access_token",
        "refresh_token",
        "user",
      ]);
      assertUserContract(validLoginPayload.data.user, {
        id: registerPayload.data.user.id,
        email,
        display_name: "Member A",
      });
      assertJwtLikeToken(validLoginPayload.data.access_token);
      assertJwtLikeToken(validLoginPayload.data.refresh_token);

      const lastLogin = await getPool().query(
        `SELECT last_login_at
         FROM users
         WHERE id = $1`,
        [registerPayload.data.user.id],
      );

      assert.ok(lastLogin.rows[0].last_login_at);

      const invalidMeResponse = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: "Bearer invalid-token",
        },
      });

      assert.equal(invalidMeResponse.statusCode, 401);
      assertAuthRequiredError(invalidMeResponse.json());
    });
  } finally {
    await deleteUsersByEmail([email]);
  }
});
