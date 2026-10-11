// 部署平台 handler：Hugging Face Space 变量与重启
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { Globals } from '../../configs/globals.js';
import { HandlerFactory } from '../../configs/handlers/handler-factory.js';
import { HuggingfaceHandler } from '../../configs/handlers/huggingface-handler.js';
import { mockJsonResponse, token, withMockFetch } from '../helpers/context.js';

test('HandlerFactory should support Hugging Face Spaces', async () => {
    const handler = await HandlerFactory.getHandler('huggingface');

    assert(handler instanceof HuggingfaceHandler);
    assert(HandlerFactory.getSupportedPlatforms().includes('huggingface'));
  });
test('HuggingfaceHandler should call Space variables and restart APIs', async () => {
    const env = {
      DEPLOY_PLATFROM_ACCOUNT: 'hf-user',
      DEPLOY_PLATFROM_PROJECT: 'hf-space',
      DEPLOY_PLATFROM_TOKEN: 'hf-token'
    };
    Globals.init(env);
    const globals = Globals.getConfig();
    const handler = new HuggingfaceHandler();

    await withMockFetch(async (url, options) => {
      if (url === 'https://huggingface.co/api/spaces/hf-user/hf-space/variables' && options.method === 'POST') {
        assert.equal(options.headers.Authorization, 'Bearer hf-token');
        assert.deepEqual(JSON.parse(options.body), { key: 'DANMU_LIMIT', value: '1' });
        return mockJsonResponse({}, url);
      }
      if (url === 'https://huggingface.co/api/spaces/hf-user/hf-space/variables' && options.method === 'DELETE') {
        assert.equal(options.headers.Authorization, 'Bearer hf-token');
        assert.deepEqual(JSON.parse(options.body), { key: 'DANMU_LIMIT' });
        return mockJsonResponse({}, url);
      }
      if (url === 'https://huggingface.co/api/spaces/hf-user/hf-space/restart' && options.method === 'POST') {
        assert.equal(options.headers.Authorization, 'Bearer hf-token');
        return mockJsonResponse({}, url);
      }
      throw new Error(`Unexpected request: ${options.method} ${url}`);
    }, async () => {
      assert.equal(await handler.setEnv('DANMU_LIMIT', 1), true);
      assert.equal(globals.env.DANMU_LIMIT, 1);
      assert.equal(await handler.delEnv('DANMU_LIMIT'), true);
      assert.equal(await handler.deploy(), true);
    });
  });
