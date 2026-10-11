// 通用工具：季号标记识别
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { Season } from '../../models/dandan-model.js';
import { extractSeasonNumberFromAnimeTitle } from '../../utils/common-util.js';

test('season extraction recognizes season markers', () => {
  // 尾部阿拉伯数字、中文数字、S/Season/Part、罗马数字均识别为季号
  assert.equal(extractSeasonNumberFromAnimeTitle('赛马娘2').season, 2);
  assert.equal(extractSeasonNumberFromAnimeTitle('赛马娘 2').season, 2);
  assert.equal(extractSeasonNumberFromAnimeTitle('孤独摇滚 12').season, 12);
  assert.equal(extractSeasonNumberFromAnimeTitle('为美好的世界献上祝福3').season, 3);
  assert.equal(extractSeasonNumberFromAnimeTitle('辉夜大小姐想让我告白 二').season, 2);
  assert.equal(extractSeasonNumberFromAnimeTitle('咒术回战 S2').season, 2);
  assert.equal(extractSeasonNumberFromAnimeTitle('咒术回战 Part 2').season, 2);
  assert.equal(extractSeasonNumberFromAnimeTitle('无职转生 第三季').season, 3);
  assert.equal(extractSeasonNumberFromAnimeTitle('無職転生Ⅲ ～異世界行ったら本気だす～').season, 3);
  assert.equal(extractSeasonNumberFromAnimeTitle('无职转生Ⅲ ～到了异世界就拿出真本事～').season, 3);
  assert.equal(extractSeasonNumberFromAnimeTitle('OVERLORD Ⅳ').season, 4);
  assert.equal(extractSeasonNumberFromAnimeTitle('约会大作战Ⅴ').season, 5);

  // 拉丁字母形式的罗马数字与英文缩写无法区分，不参与季号识别
  assert.equal(extractSeasonNumberFromAnimeTitle('机动战士V高达').season, null);
  assert.equal(extractSeasonNumberFromAnimeTitle('MAD MAX').season, null);

  // 季号剥离后余下部分作为 baseTitle
  assert.equal(extractSeasonNumberFromAnimeTitle('無職転生Ⅲ ～異世界行ったら本気だす～').baseTitle, '無職転生異世界行ったら本気だす');
});
