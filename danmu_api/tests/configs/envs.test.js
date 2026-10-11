// 环境变量解析：TITLE_NOISE_FILTER 默认规则
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { Envs } from '../../configs/envs.js';

test('TITLE_NOISE_FILTER 默认规则为合法正则，且文档默认值与其一致', async () => {
    const savedEnv = Envs.env;
    const savedSystemEnv = process.env.TITLE_NOISE_FILTER;
    try {
      // 未设置该变量时应回退到内置默认规则，而不是因默认规则非法而返回 null（禁用整个清理）
      Envs.env = {};
      delete process.env.TITLE_NOISE_FILTER;
      const pattern = Envs.resolveTitleNoiseFilter();
      assert.ok(pattern instanceof RegExp, '未设置 TITLE_NOISE_FILTER 时应返回可用的默认正则');

      // 半角/全角圆括号与方括号均需命中
      assert.strictEqual('百花杀（真彩）'.replace(pattern, '').trim(), '百花杀');
      assert.strictEqual('百花杀(真彩)'.replace(pattern, '').trim(), '百花杀');
      assert.strictEqual('百花杀[真彩]'.replace(pattern, '').trim(), '百花杀');
      assert.strictEqual('百花杀［真彩］'.replace(pattern, '').trim(), '百花杀');

      // 原版规则不含年份分支，年份不参与清理；无杂音词时保持原样
      assert.strictEqual('吞噬星空（2024）'.replace(pattern, '').trim(), '吞噬星空（2024）');
      assert.strictEqual('百花杀'.replace(pattern, '').trim(), '百花杀');

      // 对外记录的默认值须与代码默认值一致，且可直接编译
      assert.strictEqual(Envs.accessedEnvVars.get('TITLE_NOISE_FILTER'), pattern.source);
      assert.doesNotThrow(() => new RegExp(pattern.source, 'gi'));

      // README 与默认配置文件中的默认值必须与代码默认值完全一致，否则用户照抄会得到非法正则
      for (const docUrl of [new URL('../../../README.md', import.meta.url), new URL('../../../config/.env.example', import.meta.url)]) {
        const text = await fs.readFile(docUrl, 'utf8');
        assert.ok(text.includes(pattern.source), `${docUrl.pathname} 中的默认值应与代码默认值一致`);
      }

      // 显式设为空值表示禁用
      Envs.env = { TITLE_NOISE_FILTER: '' };
      assert.strictEqual(Envs.resolveTitleNoiseFilter(), null);
    } finally {
      Envs.env = savedEnv;
      if (savedSystemEnv === undefined) delete process.env.TITLE_NOISE_FILTER;
      else process.env.TITLE_NOISE_FILTER = savedSystemEnv;
    }
  });

test('envs RAW_ENV_KEYS 保留 # 不被 dotenv 截断', async (t) => {
  const reset = () => { Envs.systemEnvBackup = null; Envs.rawEnvValues = null; Envs.env = undefined; };

  await t.test('parseRawEnvText 保留行内 # 与剥除外层双引号', () => {
    const parsed = Envs.parseRawEnvText('K1=v1\nK2=v with # hash\nK3="q # v"');
    assert.strictEqual(parsed.K2, 'v with # hash');
    assert.strictEqual(parsed.K3, 'q # v');
  });

  await t.test('CUSTOM_MERGE_RULES / COLOR_POOL / URL 类变量含 # 完整保留', () => {
    reset();
    Envs.systemEnvBackup = {};
    Envs.rawEnvValues = {
      CUSTOM_MERGE_RULES: 'A #1 revival@bili',
      COLOR_POOL: '#FF0000,#00FF00',
      DANMU_PUSH_URL: 'http://h.com/cb#frag',
    };
    assert.strictEqual(Envs.get('CUSTOM_MERGE_RULES', '', 'string'), 'A #1 revival@bili');
    assert.strictEqual(Envs.get('COLOR_POOL', '', 'string'), '#FF0000,#00FF00');
    assert.strictEqual(Envs.get('DANMU_PUSH_URL', '', 'string'), 'http://h.com/cb#frag');
  });

  await t.test('加密变量保留 # 且仅以掩码写入预览集合', () => {
    reset();
    Envs.systemEnvBackup = {};
    Envs.rawEnvValues = { DANDANPLAY_PASSWORD: 'p#w' };
    assert.strictEqual(Envs.get('DANDANPLAY_PASSWORD', 'DEF', 'string', true), 'p#w');
    assert.strictEqual(Envs.accessedEnvVars.get('DANDANPLAY_PASSWORD'), '***');
    assert.strictEqual(Envs.originalEnvVars.get('DANDANPLAY_PASSWORD'), 'p#w');
  });
});
