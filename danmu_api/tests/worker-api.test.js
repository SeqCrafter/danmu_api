// 请求级端点测试：欢迎页与请求体（分块/多字节/multipart）处理
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import { parseLocalDanmu } from '../utils/local-danmu-parser.js';
import { handleRequest } from '../worker.js';
import { MockRequest, parseResponse, readRequestBody, urlPrefix } from './helpers/context.js';
import { localDanmuEncodings, localDanmuExpected, localDanmuJson } from './helpers/local-danmu.js';
import { matchAnime, searchAnime } from '../apis/dandan-api.js';
import { Globals } from '../configs/globals.js';
import { SegmentListResponse } from '../models/dandan-model.js';
import BilibiliSource from '../sources/bilibili.js';
import IqiyiSource from '../sources/iqiyi.js';
import TencentSource from '../sources/tencent.js';
import YoukuSource from '../sources/youku.js';
import { addAnime, addEpisode } from '../utils/cache-util.js';
import { createSearchResult, resetSearchState } from './helpers/context.js';

test('GET / should return welcome message', async () => {
    const req = new MockRequest(urlPrefix, { method: 'GET' });
    const res = await handleRequest(req);
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
  });
for (const [encoding, encode] of localDanmuEncodings) {
  test(`multipart upload preserves and parses ${encoding} across byte boundaries`, async () => {
    const fileBytes = encode(localDanmuJson);
    const boundary = 'local-danmu-test-boundary';
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="danmu.json"\r\nContent-Type: application/json\r\n\r\n`);
    const multipart = Buffer.concat([header, fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    // 每块一个字节，覆盖中文、emoji、BOM 和 UTF-16 码元被分块的情况。
    const chunks = Array.from(multipart, (_, index) => multipart.subarray(index, index + 1));
    const body = await readRequestBody(Readable.from(chunks));
    assert.deepEqual(body, multipart);

    const request = new Request('http://localhost/api/local-danmu/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const form = await request.formData();
    const file = form.get('file');
    const uploadedBytes = Buffer.from(await file.arrayBuffer());
    assert.deepEqual(uploadedBytes, fileBytes);
    assert.deepEqual(parseLocalDanmu(uploadedBytes, file.name), localDanmuExpected);
  });
}
test('ordinary JSON request bodies retain multibyte characters across chunks', async () => {
  const payload = { title: '逐玉', text: '中文😀' };
  const bytes = Buffer.from(JSON.stringify(payload));
  const split = bytes.findIndex(byte => byte >= 0x80) + 1;
  const body = await readRequestBody(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]));
  const request = new Request('http://localhost/api/example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.deepEqual(await request.json(), payload);
});
test('request body read errors are propagated', async () => {
  const failure = new Error('request interrupted');
  const request = Readable.from((async function* () {
    yield Buffer.from('partial');
    throw failure;
  })());
  await assert.rejects(readRequestBody(request), error => error === failure);
});

test('GET /api/v2/comment/:id?format=json&duration=true should use merged max duration', async () => {
  Globals.init({});
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.commentCache = new Map();

  const originalTencentGetComments = TencentSource.prototype.getComments;
  const originalIqiyiGetComments = IqiyiSource.prototype.getComments;
  const originalYoukuGetComments = YoukuSource.prototype.getComments;

  TencentSource.prototype.getComments = async function(url, plat, segmentFlag) {
    if (segmentFlag) {
      return {
        type: 'qq',
        segmentList: [
          { type: 'qq', segment_start: 0, segment_end: 2760, url: 'mock-qq' }
        ]
      };
    }
    return [
      { p: '12.3,1,16777215,qq', m: '腾讯弹幕' }
    ];
  };

  IqiyiSource.prototype.getComments = async function(url, plat, segmentFlag) {
    if (segmentFlag) {
      return {
        type: 'qiyi',
        segmentList: [
          { type: 'qiyi', segment_start: 0, segment_end: 1200, url: 'mock-qiyi-1' },
          { type: 'qiyi', segment_start: 1200, segment_end: 2682, url: 'mock-qiyi-2' }
        ]
      };
    }
    return [
      { p: '15.0,1,16777215,qiyi', m: '爱奇艺弹幕' }
    ];
  };

  YoukuSource.prototype.getComments = async function(url, plat, segmentFlag) {
    if (segmentFlag) {
      return {
        type: 'youku',
        segmentList: [
          { type: 'youku', segment_start: 0, segment_end: 1800, url: 'mock-youku-1' },
          { type: 'youku', segment_start: 1800, segment_end: 3000, url: 'mock-youku-2' }
        ]
      };
    }
    return [
      { p: '18.0,1,16777215,youku', m: '优酷弹幕' }
    ];
  };

  try {
    const episode = addEpisode(
      'tencent:https://v.qq.com/x/cover/a/b.html$$$iqiyi:https://www.iqiyi.com/v_test.html$$$youku:https://v.youku.com/v_show/id_test.html',
      '【qq＆qiyi＆youku】合并测试'
    );
    const req = new MockRequest(urlPrefix + '/api/v2/comment/' + episode.id + '?format=json&duration=true', { method: 'GET' });
    const res = await handleRequest(req);
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
    assert.equal(body.videoDuration, 3000);
    assert.ok(Array.isArray(body.comments));
  } finally {
    TencentSource.prototype.getComments = originalTencentGetComments;
    IqiyiSource.prototype.getComments = originalIqiyiGetComments;
    YoukuSource.prototype.getComments = originalYoukuGetComments;
    Globals.episodeIds = [];
    Globals.commentCache = new Map();
  }
});

test('GET /api/v2/comment/:id?format=json&duration=true should prefer explicit duration field', async () => {
  Globals.init({});
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.commentCache = new Map();

  const originalBilibiliGetComments = BilibiliSource.prototype.getComments;
  BilibiliSource.prototype.getComments = async function(url, plat, segmentFlag) {
    if (segmentFlag) {
      return new SegmentListResponse({
        type: 'bilibili1',
        duration: 1312.76,
        segmentList: [
          { type: 'bilibili1', segment_start: 0, segment_end: 360, url: 'mock-bili-1' },
          { type: 'bilibili1', segment_start: 360, segment_end: 720, url: 'mock-bili-2' },
          { type: 'bilibili1', segment_start: 720, segment_end: 1080, url: 'mock-bili-3' },
          { type: 'bilibili1', segment_start: 1080, segment_end: 1440, url: 'mock-bili-4' }
        ]
      });
    }
    return [
      { p: '20.0,1,16777215,bilibili1', m: 'B站弹幕1' },
      { p: '30.0,1,16777215,bilibili1', m: 'B站弹幕2' }
    ];
  };

  try {
    const episode = addEpisode('https://www.bilibili.com/bangumi/play/ep_test.html', '【bilibili】测试样例');
    const req = new MockRequest(urlPrefix + '/api/v2/comment/' + episode.id + '?format=json&duration=true', { method: 'GET' });
    const res = await handleRequest(req);
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
    assert.equal(body.videoDuration, 1312.76);
    assert.equal(body.count, 2);
  } finally {
    BilibiliSource.prototype.getComments = originalBilibiliGetComments;
    Globals.episodeIds = [];
    Globals.commentCache = new Map();
  }
});

test('GET /api/v2/bangumi/:id should resolve details from search cache after global eviction', async () => {
  Globals.init({});
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.requestHistory = new Map();
  Globals.envs.rateLimitMaxRequests = 0;
  delete Globals.requestAnimeDetailsMap;

  const cachedAnime = {
    animeId: 500001,
    bangumiId: '500001',
    animeTitle: '缓存详情番剧',
    type: 'tvseries',
    typeDescription: 'TV',
    imageUrl: 'https://example.com/poster.jpg',
    startDate: '2024-01-01T00:00:00.000Z',
    episodeCount: 2,
    rating: 0,
    isFavorited: true,
    source: 'tencent',
    links: [
      { id: 30001, url: 'https://v.qq.com/x/cover/cache/ep1.html', title: '【qq】 第1集' },
      { id: 30002, url: 'https://v.qq.com/x/cover/cache/ep2.html', title: '【qq】 第2集' }
    ]
  };

  Globals.searchCache.set('缓存详情番剧', {
    results: [
      {
        animeId: cachedAnime.animeId,
        bangumiId: cachedAnime.bangumiId,
        animeTitle: cachedAnime.animeTitle,
        type: cachedAnime.type,
        typeDescription: cachedAnime.typeDescription,
        imageUrl: cachedAnime.imageUrl,
        startDate: cachedAnime.startDate,
        episodeCount: cachedAnime.episodeCount,
        rating: cachedAnime.rating,
        isFavorited: cachedAnime.isFavorited,
        source: cachedAnime.source
      }
    ],
    details: [cachedAnime],
    timestamp: Date.now()
  });

  const req = new MockRequest(urlPrefix + '/api/v2/bangumi/' + cachedAnime.animeId, { method: 'GET' });
  const res = await handleRequest(req);
  const body = await parseResponse(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.bangumi.animeTitle, cachedAnime.animeTitle);
  assert.equal(body.bangumi.episodes.length, 2);
  assert.equal(body.bangumi.episodes[0].episodeId, 30001);
  assert.equal(Globals.animes.length, 0);
  assert.equal(Globals.episodeIds.length, 0);
});

test('GET /api/v2/comment/:id should resolve cached episode context after global eviction', async () => {
  Globals.init({});
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.commentCache = new Map();
  Globals.requestHistory = new Map();
  Globals.envs.rateLimitMaxRequests = 0;
  delete Globals.requestAnimeDetailsMap;

  const cachedAnime = {
    animeId: 500002,
    bangumiId: '500002',
    animeTitle: '缓存弹幕番剧',
    type: 'tvseries',
    typeDescription: 'TV',
    imageUrl: 'https://example.com/poster2.jpg',
    startDate: '2024-01-01T00:00:00.000Z',
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: 'tencent',
    links: [
      { id: 31001, url: 'https://v.qq.com/x/cover/cache/comment-ep1.html', title: '【qq】 第1集' }
    ]
  };

  Globals.searchCache.set('缓存弹幕番剧', {
    results: [
      {
        animeId: cachedAnime.animeId,
        bangumiId: cachedAnime.bangumiId,
        animeTitle: cachedAnime.animeTitle,
        type: cachedAnime.type,
        typeDescription: cachedAnime.typeDescription,
        imageUrl: cachedAnime.imageUrl,
        startDate: cachedAnime.startDate,
        episodeCount: cachedAnime.episodeCount,
        rating: cachedAnime.rating,
        isFavorited: cachedAnime.isFavorited,
        source: cachedAnime.source
      }
    ],
    details: [cachedAnime],
    timestamp: Date.now()
  });

  const originalTencentGetComments = TencentSource.prototype.getComments;
  let requestCount = 0;

  TencentSource.prototype.getComments = async function(url, plat, segmentFlag) {
    requestCount++;
    assert.equal(url, cachedAnime.links[0].url);
    assert.equal(plat, 'qq');
    assert.equal(segmentFlag, false);
    return [
      { p: '12.3,1,16777215,qq', m: '缓存弹幕命中' }
    ];
  };

  try {
    const req = new MockRequest(urlPrefix + '/api/v2/comment/' + cachedAnime.links[0].id + '?format=json', { method: 'GET' });
    const res = await handleRequest(req);
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.comments[0].m, '缓存弹幕命中');
    assert.equal(requestCount, 1);
    assert.equal(Globals.animes.length, 0);
    assert.equal(Globals.episodeIds.length, 0);
  } finally {
    TencentSource.prototype.getComments = originalTencentGetComments;
    Globals.commentCache = new Map();
  }
});

test('GET /api/v2/bangumi/:id should prefer latest cached detail snapshot', async () => {
  resetSearchState();

  const oldAnime = {
    animeId: 500003,
    bangumiId: "500003",
    animeTitle: "旧缓存详情番剧",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "https://example.com/old-poster.jpg",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: "tencent",
    links: [
      { id: 32001, url: "https://v.qq.com/x/cover/cache-old/ep1.html", title: "【qq】 旧快照 第1集" }
    ]
  };

  const latestAnime = {
    ...oldAnime,
    animeTitle: "新缓存详情番剧",
    episodeCount: 2,
    links: [
      { id: 32002, url: "https://v.qq.com/x/cover/cache-new/ep1.html", title: "【qq】 新快照 第1集" },
      { id: 32003, url: "https://v.qq.com/x/cover/cache-new/ep2.html", title: "【qq】 新快照 第2集" }
    ]
  };

  Globals.searchCache.set("旧缓存详情番剧", {
    results: [createSearchResult(oldAnime)],
    details: [oldAnime],
    timestamp: Date.now() - 5_000
  });
  Globals.searchCache.set("新缓存详情番剧", {
    results: [createSearchResult(latestAnime)],
    details: [latestAnime],
    timestamp: Date.now()
  });

  const req = new MockRequest(urlPrefix + "/api/v2/bangumi/" + latestAnime.animeId, { method: "GET" });
  const res = await handleRequest(req);
  const body = await parseResponse(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.bangumi.animeTitle, latestAnime.animeTitle);
  assert.equal(body.bangumi.episodes.length, 2);
  assert.equal(body.bangumi.episodes[0].episodeId, 32002);
  assert.equal(body.bangumi.episodes[1].episodeId, 32003);
});

test('GET /api/v2/search/episodes should keep colliding cached details separated', async () => {
  resetSearchState();

  const renrenAnime = {
    animeId: 888,
    bangumiId: "123",
    animeTitle: "缓存冲突番剧A",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "https://example.com/renren.jpg",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: "renren",
    links: [
      { id: 33001, url: "renren://cache-a-ep1", title: "【renren】 第1集" }
    ]
  };

  const iqiyiAnime = {
    animeId: 123,
    bangumiId: "999",
    animeTitle: "缓存冲突番剧B",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "https://example.com/iqiyi.jpg",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: "iqiyi",
    links: [
      { id: 33002, url: "https://www.iqiyi.com/v_cache_b.html", title: "【qiyi】 第1集" }
    ]
  };

  const keyword = "缓存冲突测试";
  Globals.searchCache.set(keyword, {
    results: [createSearchResult(renrenAnime), createSearchResult(iqiyiAnime)],
    details: [renrenAnime, iqiyiAnime],
    timestamp: Date.now()
  });

  const req = new MockRequest(urlPrefix + "/api/v2/search/episodes?anime=" + encodeURIComponent(keyword), { method: "GET" });
  const res = await handleRequest(req);
  const body = await parseResponse(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.animes.length, 2);

  const renrenResult = body.animes.find(item => item.animeId === renrenAnime.animeId);
  const iqiyiResult = body.animes.find(item => item.animeId === iqiyiAnime.animeId);

  assert.ok(renrenResult);
  assert.ok(iqiyiResult);
  assert.equal(renrenResult.episodes.length, 1);
  assert.equal(renrenResult.episodes[0].episodeId, renrenAnime.links[0].id);
  assert.equal(renrenResult.episodes[0].episodeTitle, renrenAnime.links[0].title);
  assert.equal(iqiyiResult.episodes.length, 1);
  assert.equal(iqiyiResult.episodes[0].episodeId, iqiyiAnime.links[0].id);
  assert.equal(iqiyiResult.episodes[0].episodeTitle, iqiyiAnime.links[0].title);
});

test('GET /api/v2/search/episodes should ignore polluted global detail cache state', async () => {
  resetSearchState();

  const cachedAnime = {
    animeId: 700001,
    bangumiId: "700001",
    animeTitle: "全局污染回归番剧",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "https://example.com/cache-correct.jpg",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: "tencent",
    links: [
      { id: 34001, url: "https://v.qq.com/x/cover/cache-correct/ep1.html", title: "【qq】 正确第1集" }
    ]
  };

  const pollutedAnime = {
    ...cachedAnime,
    animeTitle: "错误污染番剧",
    links: [
      { id: 34999, url: "https://v.qq.com/x/cover/cache-polluted/ep1.html", title: "【qq】 错误第1集" }
    ]
  };

  const keyword = "全局污染测试";
  Globals.searchCache.set(keyword, {
    results: [createSearchResult(cachedAnime)],
    details: [cachedAnime],
    timestamp: Date.now()
  });
  Globals.requestAnimeDetailsMap = new Map([
    [String(cachedAnime.bangumiId), pollutedAnime],
    [String(cachedAnime.animeId), pollutedAnime]
  ]);

  try {
    const req = new MockRequest(urlPrefix + "/api/v2/search/episodes?anime=" + encodeURIComponent(keyword), { method: "GET" });
    const res = await handleRequest(req);
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].animeId, cachedAnime.animeId);
    assert.equal(body.animes[0].episodes[0].episodeId, cachedAnime.links[0].id);
    assert.equal(body.animes[0].episodes[0].episodeTitle, cachedAnime.links[0].title);
  } finally {
    delete Globals.requestAnimeDetailsMap;
  }
});

test('POST /api/v2/match should ignore polluted global anime details and use current search snapshot', async () => {
  resetSearchState();

  const correctLinks = Array.from({ length: 50 }, (_, index) => ({
    id: 35001 + index,
    url: `https://www.iqiyi.com/v_match_correct_${index + 1}.html`,
    title: `【qiyi】 太平年第${index + 1}集`
  }));

  const cachedAnime = {
    animeId: 700002,
    bangumiId: "700002",
    animeTitle: "太平年(2024)【TV】from iqiyi",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "https://example.com/tp.jpg",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 50,
    rating: 0,
    isFavorited: true,
    source: "iqiyi",
    links: correctLinks
  };

  const pollutedAnime = {
    ...cachedAnime,
    links: correctLinks.map(link => ({ ...link }))
  };
  pollutedAnime.links[41] = {
    id: 35999,
    url: "https://www.iqiyi.com/v_match_polluted_45.html",
    title: "【qiyi】 太平年第45集 金陵落日"
  };

  Globals.searchCache.set("太平年", {
    results: [createSearchResult(cachedAnime)],
    details: [cachedAnime],
    timestamp: Date.now()
  });
  Globals.animes = [pollutedAnime];

  const req = {
    url: urlPrefix + "/api/v2/match",
    async json() {
      return {
        fileName: "太平年 S01E42"
      };
    }
  };

  const res = await matchAnime(new URL(req.url), req, "127.0.0.1");
  const body = await parseResponse(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.isMatched, true);
  assert.equal(body.matches.length, 1);
  assert.equal(body.matches[0].episodeId, cachedAnime.links[41].id);
  assert.equal(body.matches[0].episodeTitle, cachedAnime.links[41].title);
});

test('GET /api/v2/search/anime should filter by request snapshot instead of collided runtime animeId state', async () => {
  resetSearchState();

  const originalTencentSearch = TencentSource.prototype.search;
  const originalTencentHandleAnimes = TencentSource.prototype.handleAnimes;
  const originalIqiyiSearch = IqiyiSource.prototype.search;
  const originalIqiyiHandleAnimes = IqiyiSource.prototype.handleAnimes;
  const originalSourceOrderArr = Array.isArray(Globals.envs.sourceOrderArr) ? [...Globals.envs.sourceOrderArr] : Globals.envs.sourceOrderArr;
  const originalEnableAnimeEpisodeFilter = Globals.envs.enableAnimeEpisodeFilter;
  const originalEpisodeTitleFilter = Globals.envs.episodeTitleFilter;
  const originalAnimeTitleFilter = Globals.envs.animeTitleFilter;

  const sharedAnimeId = 880001;
  const tencentAnime = {
    animeId: sharedAnimeId,
    bangumiId: "tx-880001",
    animeTitle: "同ID跨源番剧",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: false,
    source: "tencent",
    links: [
      { url: "https://v.qq.com/x/cover/collision/ep1.html", title: "【qq】 正片第1集" }
    ]
  };
  const iqiyiAnime = {
    animeId: sharedAnimeId,
    bangumiId: "iqiyi-880001",
    animeTitle: "同ID跨源番剧",
    type: "tvseries",
    typeDescription: "TV",
    imageUrl: "",
    startDate: "2024-01-01T00:00:00.000Z",
    episodeCount: 1,
    rating: 0,
    isFavorited: false,
    source: "iqiyi",
    links: [
      { url: "https://www.iqiyi.com/v_collision_extra.html", title: "【qiyi】 花絮" }
    ]
  };

  Globals.envs.sourceOrderArr = ["tencent", "iqiyi"];
  Globals.envs.enableAnimeEpisodeFilter = true;
  Globals.envs.episodeTitleFilter = /花絮/;
  Globals.envs.animeTitleFilter = null;

  TencentSource.prototype.search = async () => [createSearchResult(tencentAnime)];
  TencentSource.prototype.handleAnimes = async (_results, _queryTitle, curAnimes, detailStore) => {
    curAnimes.push(createSearchResult(tencentAnime));
    addAnime(tencentAnime, detailStore);
  };
  IqiyiSource.prototype.search = async () => [createSearchResult(iqiyiAnime)];
  IqiyiSource.prototype.handleAnimes = async (_results, _queryTitle, curAnimes, detailStore) => {
    curAnimes.push(createSearchResult(iqiyiAnime));
    addAnime(iqiyiAnime, detailStore);
  };

  try {
    const req = new MockRequest(urlPrefix + "/api/v2/search/anime?keyword=" + encodeURIComponent("同ID跨源番剧"), { method: "GET" });
    const res = await searchAnime(new URL(req.url), null, null, new Map());
    const body = await parseResponse(res);

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].animeId, tencentAnime.animeId);
    assert.equal(body.animes[0].source, tencentAnime.source);
    assert.equal(body.animes[0].animeTitle, tencentAnime.animeTitle);
  } finally {
    TencentSource.prototype.search = originalTencentSearch;
    TencentSource.prototype.handleAnimes = originalTencentHandleAnimes;
    IqiyiSource.prototype.search = originalIqiyiSearch;
    IqiyiSource.prototype.handleAnimes = originalIqiyiHandleAnimes;
    Globals.envs.sourceOrderArr = Array.isArray(originalSourceOrderArr) ? [...originalSourceOrderArr] : originalSourceOrderArr;
    Globals.envs.enableAnimeEpisodeFilter = originalEnableAnimeEpisodeFilter;
    Globals.envs.episodeTitleFilter = originalEpisodeTitleFilter;
    Globals.envs.animeTitleFilter = originalAnimeTitleFilter;
  }
});
