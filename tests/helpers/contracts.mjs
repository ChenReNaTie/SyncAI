import assert from "node:assert/strict";

export async function expectRouteImplemented(app, request, context) {
  const response = await app.inject(request);

  assert.notEqual(
    response.statusCode,
    404,
    `${context.id} is still missing ${request.method} ${request.url}. ` +
      `This group covers ${context.cases.join(", ")} from docs/测试脚本设计.md and docs/API设计.md.`,
  );

  return response;
}
