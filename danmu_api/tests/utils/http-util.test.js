// HTTP 工具：httpPatch 与 GET/POST 行为一致
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { httpPatch } from '../../utils/http-util.js';
import { mockJsonResponse, withMockFetch } from '../helpers/context.js';

test('httpPatch 的 allow_redirects 与 GET/POST 行为一致', async () => {
  let seenOptions = null;
  const capture = async (url, options) => { seenOptions = options; return mockJsonResponse({}, url); };

  await withMockFetch(capture, () => httpPatch('http://example.com/a', 'body', { allow_redirects: false }));
  assert.strictEqual(seenOptions.redirect, 'manual', '禁止重定向时使用 manual');

  await withMockFetch(capture, () => httpPatch('http://example.com/b', 'body', {}));
  assert.strictEqual(seenOptions.redirect, 'follow', '默认跟随重定向');
});
