/* 豆瓣核心功能 */
import {getDoubanDetail} from "../utils/douban-util.js";
/* 各种源 */
import DoubanSource from "../sources/douban.js";
import TencentSource from "../sources/tencent.js";
import IqiyiSource from "../sources/iqiyi.js";
import BilibiliSource from "../sources/bilibili.js";
import MiguSource from "../sources/migu.js";
import YoukuSource from "../sources/youku.js";
/* 缓存 */
import {
  getSearchCache,
  setSearchCache,
  updateLocalCaches,
  findUrlById,
} from "../utils/cache-util.js";
import {updateRedisCaches} from "../utils/redis-util.js";
/* 日志 */
import {log} from "../utils/log-util.js";
/* 网络功能 */
import {jsonResponse} from "../utils/http-util.js";
/* 全局函数 */
import {globals} from "../configs/globals.js";
/* logvar核心功能 */
import {matchAnime, getBangumi, getCommentByUrl} from "./dandan-api.js";
/* 数据结构 */
import {Episodes} from "../models/dandan-model.js";
/* 通用函数 */
import {
  extractEpisodeTitle,
  extractEpisodeNumberFromTitle,
} from "../utils/common-util.js";

const tencentSource = new TencentSource();
const youkuSource = new YoukuSource();
const iqiyiSource = new IqiyiSource();
const bilibiliSource = new BilibiliSource();
const miguSource = new MiguSource();

const doubanSource = new DoubanSource(
  tencentSource,
  iqiyiSource,
  youkuSource,
  bilibiliSource,
  miguSource,
);

// 后处理弹幕数据：将对象格式转换为数组格式
// 输入格式：{ count: 123, comments: [{cid: 1, p: "0.00,1,16777215,[qq]", m: "弹幕", t: 0}] }
// 输出格式：{ code: 0, name: "123", danum: 123, danmuku: [[0, "right", "#FFFFFF", "25px", "弹幕"]] }
export function postProcessDanmu(danmuData) {
  // RGB 整数转 Hex 字符串
  const intToHex = (num) => {
    const hex = parseInt(num).toString(16).toUpperCase().padStart(6, "0");
    return `#${hex}`;
  };

  // 位置映射：1,2,3 -> "right", 4 -> "top", 5 -> "bottom"
  const modeToPosition = (mode) => {
    const modeNum = parseInt(mode);
    if (modeNum === 4) return "top";
    if (modeNum === 5) return "bottom";
    return "right"; // 1, 2, 3 都是 right
  };

  // 转换每个弹幕对象为数组格式
  const danmuku = (danmuData.comments || []).map((comment) => {
    const pValues = comment.p.split(",");
    const time = parseFloat(pValues[0]) || 0;
    const position = modeToPosition(pValues[1]);
    const color = intToHex(pValues[2] || 16777215);
    const fontSize = "25px";
    const content = comment.m || "";

    return [time, position, color, fontSize, content];
  });

  // 返回新格式
  return {
    code: danmuData.errorCode,
    name: String(danmuData.url || ""), // 使用 url 作为 name 的值
    danum: danmuData.count || 0,
    danmuku: danmuku,
  };
}

// 根据集数匹配episode（优先使用集标题中的集数，其次使用episodeNumber，最后使用数组索引）
function findEpisodeByNumber(filteredEpisodes, targetEpisode, platform = null) {
  if (!filteredEpisodes || filteredEpisodes.length === 0) {
    return null;
  }

  // 如果指定了平台，先过滤出该平台的集数 (修改点：使用 getPlatformMatchScore 支持模糊匹配)
  let platformEpisodes = filteredEpisodes;
  if (platform) {
    platformEpisodes = filteredEpisodes.filter((ep) => {
      const epTitlePlatform = extractEpisodeTitle(ep.episodeTitle);
      // 使用评分机制判断是否匹配，只要有分就保留
      return getPlatformMatchScore(epTitlePlatform, platform) > 0;
    });
  }

  if (platformEpisodes.length === 0) {
    return null;
  }

  // 策略1：从集标题中提取集数进行匹配
  for (const ep of platformEpisodes) {
    const extractedNumber = extractEpisodeNumberFromTitle(ep.episodeTitle);
    if (extractedNumber === targetEpisode) {
      log(
        "info",
        `Found episode by title number: ${ep.episodeTitle} (extracted: ${extractedNumber})`,
      );
      return ep;
    }
  }

  // 策略2：使用数组索引
  if (platformEpisodes.length >= targetEpisode) {
    const fallbackEp = platformEpisodes[targetEpisode - 1];
    log(
      "info",
      `Using fallback array index for episode ${targetEpisode}: ${fallbackEp.episodeTitle}`,
    );
    return fallbackEp;
  }

  // 策略3：使用episodeNumber字段匹配
  for (const ep of platformEpisodes) {
    if (ep.episodeNumber && parseInt(ep.episodeNumber, 10) === targetEpisode) {
      log(
        "info",
        `Found episode by episodeNumber: ${ep.episodeTitle} (episodeNumber: ${ep.episodeNumber})`,
      );
      return ep;
    }
  }

  return null;
}

// Extracted function for GET /api/v2/douban
export async function getAnimeByDouban(url) {
  const doubanId = url.searchParams.get("douban_id");
  const episode = url.searchParams.get("episode_number") || "";
  const queryFormat = url.searchParams.get("format");
  const segmentFlagParam = url.searchParams.get("segmentflag");
  const segmentFlag = segmentFlagParam === "true" || segmentFlagParam === "1";

  log("info", `Get anime by douban_id: ${doubanId}, episode: ${episode}`);

  if (!doubanId) {
    log("error", "Missing douban_id parameter");
    return jsonResponse(
      {
        errorCode: 400,
        success: false,
        errorMessage: "Missing douban_id parameter",
      },
      400,
    );
  }

  // 定义缓存键（用于缓存 episodes 列表，包含所有 URL）
  const cacheKey = `douban_${doubanId}`;

  // 检查缓存（无论是否有 episode 参数）
  // 缓存的是包含所有 episodes 和 URLs 的 resultAnimes
  let resultAnimes = getSearchCache(cacheKey);

  // 如果缓存未命中，执行完整的获取流程
  if (resultAnimes === null) {
    log("info", `Cache miss for douban_id: ${doubanId}, fetching from source`);

    try {
      // 获取豆瓣详情
      const response = await getDoubanDetail(doubanId);

      if (!response || !response.data) {
        log("error", "Failed to get douban detail");
        return jsonResponse({
          errorCode: 404,
          success: false,
          errorMessage: "Douban detail not found",
          hasMore: false,
          animes: [],
        });
      }

      const data = response.data;
      log("info", `Got douban detail: ${data.title}, year: ${data.year}`);

      // 构造 sourceAnimes 数组（只包含一个元素，格式与 searchDoubanTitles 返回的相同）
      const sourceAnimes = [
        {
          layout: "subject",
          target_id: doubanId,
          type_name: data.is_tv ? "电视剧" : "电影",
          target: {
            title: data.title,
            cover_url: data.pic?.large || data.pic?.normal || "",
          },
        },
      ];

      const curAnimes = [];
      resultAnimes = [];
      // 直接调用 doubanSource.handleAnimes 处理
      await doubanSource.handleAnimes(sourceAnimes, data.title, curAnimes);
      // 如果有新的anime获取到，则更新本地缓存
      if (globals.localCacheValid && curAnimes.length !== 0) {
        await updateLocalCaches();
      }
      // 如果有新的anime获取到，则更新redis
      if (globals.redisValid && curAnimes.length !== 0) {
        await updateRedisCaches();
      }
      if (curAnimes.length === 0) {
        // 添加兜底，如果豆瓣没搜索到内容，根据构造post body title@platform获取
        const matchUrlBase = new URL("/api/v2/match", url.origin);
        const req = new Request(matchUrlBase.toString(), {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({fileName: `${data.title}`}),
        });
        const matchUrl = new URL(matchUrlBase);
        matchUrl.searchParams.set("keyword", data.title);
        //调用match
        const res = await matchAnime(matchUrl, req);
        const resJson = await res.json();
        if (resJson.success && resJson.matches.length > 0) {
          const tmpAnimeData = resJson.matches[0];
          //调用getBangumi
          const path = `/api/v2/bangumi/${tmpAnimeData.animeId}`;
          const bangumiUrl = new URL(path, url.origin);
          const bangumiRes = await getBangumi(bangumiUrl.pathname);
          const bangumiData = await bangumiRes.json();
          if (
            bangumiData.success &&
            bangumiData.bangumi &&
            bangumiData.bangumi.episodes
          ) {
            const allEpisodes = bangumiData.bangumi.episodes;
            if (allEpisodes.length > 0) {
              resultAnimes.push(
                Episodes.fromJson({
                  animeId: tmpAnimeData.animeId,
                  animeTitle: tmpAnimeData.animeTitle,
                  type: tmpAnimeData.type,
                  typeDescription: tmpAnimeData.typeDescription,
                  episodes: allEpisodes.map((ep) => ({
                    episodeId: ep.episodeId,
                    episodeTitle: ep.episodeTitle,
                    episodeNumber: ep.episodeNumber,
                  })),
                }),
              );
            }
          }
        }
      } else {
        // 遍历所有找到的动漫，获取它们的集数信息
        for (const animeItem of curAnimes) {
          const bangumiUrl = new URL(
            `/bangumi/${animeItem.bangumiId}`,
            url.origin,
          );
          const bangumiRes = await getBangumi(bangumiUrl.pathname);
          const bangumiData = await bangumiRes.json();

          if (
            bangumiData.success &&
            bangumiData.bangumi &&
            bangumiData.bangumi.episodes
          ) {
            // 不做任何过滤，保留所有 episodes（包含所有 URL）
            const allEpisodes = bangumiData.bangumi.episodes;

            if (allEpisodes.length > 0) {
              resultAnimes.push(
                Episodes.fromJson({
                  animeId: animeItem.animeId,
                  animeTitle: animeItem.animeTitle,
                  type: animeItem.type,
                  typeDescription: animeItem.typeDescription,
                  episodes: allEpisodes.map((ep) => ({
                    episodeId: ep.episodeId,
                    episodeTitle: ep.episodeTitle,
                    episodeNumber: ep.episodeNumber,
                  })),
                }),
              );
            }
          }
        }
      }
      log("info", `Found ${resultAnimes.length} animes with episodes`);
      //console.log(JSON.stringify(resultAnimes));
      // 缓存结果（包含所有 episodes 和 URLs）
      if (resultAnimes.length > 0) {
        setSearchCache(cacheKey, resultAnimes);
        log("info", `Cached episodes list for douban_id: ${doubanId}`);
      }
    } catch (error) {
      log("error", `Failed to process douban request: ${error.message}`);
      return jsonResponse(
        {
          errorCode: 500,
          success: false,
          errorMessage: "Internal server error",
          hasMore: false,
          animes: [],
        },
        500,
      );
    }
  } else {
    log("info", `Cache hit for douban_id: ${doubanId}`);
  }

  // 现在有了 resultAnimes（来自缓存或新获取）
  // 根据是否有 episode 参数决定返回什么

  if (!episode) {
    // 没有 episode 参数，返回 episodes 列表
    return jsonResponse({
      errorCode: 0,
      success: true,
      errorMessage: "",
      hasMore: false,
      animes: resultAnimes,
    });
  }

  // 有 episode 参数，从 resultAnimes 中获取弹幕
  if (resultAnimes.length === 0 || resultAnimes[0].episodes.length === 0) {
    log("warn", "No episodes found in resultAnimes");
    return jsonResponse({
      errorCode: 0,
      success: true,
      errorMessage: "",
      hasMore: false,
      animes: resultAnimes,
    });
  }

  let targetEpisode = null;

  if (episode === "movie") {
    // 电影类型，直接取第一个
    targetEpisode = resultAnimes[0].episodes[0];
  } else if (/^\d+$/.test(episode)) {
    // 纯数字，使用 findEpisodeByNumber 精确匹配
    const targetEpisodeNum = parseInt(episode);
    const allEpisodes = resultAnimes[0].episodes;

    log(
      "info",
      `Searching for episode ${targetEpisodeNum} in ${allEpisodes.length} episodes`,
    );

    // 使用 findEpisodeByNumber 来匹配（不指定平台，从所有平台中查找）
    targetEpisode = findEpisodeByNumber(allEpisodes, targetEpisodeNum, null);

    if (!targetEpisode) {
      log(
        "warn",
        `Episode ${targetEpisodeNum} not found, falling back to first episode`,
      );
      targetEpisode = allEpisodes[0];
    }
  }

  if (!targetEpisode) {
    log("error", "No target episode found");
    return jsonResponse({
      errorCode: 0,
      success: true,
      errorMessage: "",
      hasMore: false,
      animes: resultAnimes,
    });
  }

  const episodeId = targetEpisode.episodeId;
  log(
    "info",
    `Getting comments for episodeId: ${episodeId}, title: ${targetEpisode.episodeTitle}`,
  );

  // 通过 episodeId 找到 url
  const videoUrl = findUrlById(episodeId);

  if (!videoUrl) {
    log("error", `No URL found for episodeId: ${episodeId}`);
    return jsonResponse({
      errorCode: 0,
      success: true,
      errorMessage: "",
      hasMore: false,
      animes: resultAnimes,
    });
  }

  log("info", `Found URL for episodeId ${episodeId}: ${videoUrl}`);

  // 直接调用 getCommentByUrl 获取弹幕
  // getCommentByUrl 内部会处理缓存检查和弹幕获取
  log("info", `Fetching comments from URL: ${videoUrl}`);
  return await getCommentByUrl(videoUrl, queryFormat, segmentFlag);
}
