// 红果源：由剧集 ID 计算分段（无需联网）
// 由 danmu_api/tests/manual/live-source-checks.js 中无需联网的用例提取而来，用例名与断言未改。

import test from 'node:test';
import assert from 'node:assert';
import { getSourceByKey } from '../../sources/registry.js';

const hongguoSource = getSourceByKey('hongguo');

test('GET hongguo danmu segments', async () => {
  const episodeId = 'hongguo:v1:series-1:vid-1:60';
  const res = await hongguoSource.getComments(episodeId, 'hongguo', true);
  assert.equal(res.type, 'hongguo');
  assert.equal(res.duration, 60);
  assert.equal(res.segmentList.length, 2);
  assert.notEqual(res.segmentList[0].url, res.segmentList[1].url);
});
