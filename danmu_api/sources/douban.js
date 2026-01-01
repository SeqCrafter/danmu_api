import BaseSource from "./base.js";
import { log } from "../utils/log-util.js";
import { getDoubanDetail, searchDoubanTitles } from "../utils/douban-util.js";

// =====================
// 获取豆瓣源播放链接
// =====================
export default class DoubanSource extends BaseSource {
  constructor(tencentSource, iqiyiSource, youkuSource, bilibiliSource) {
    super("BaseSource");
    this.tencentSource = tencentSource;
    this.iqiyiSource = iqiyiSource;
    this.youkuSource = youkuSource;
    this.bilibiliSource = bilibiliSource;
  }

  async search(keyword) {
    try {
      const response = await searchDoubanTitles(keyword);

      const data = response.data;

      let tmpAnimes = [];
      if (data?.subjects?.items?.length > 0) {
        tmpAnimes = [...tmpAnimes, ...data.subjects.items];
      }

      if (data?.smart_box?.length > 0) {
        tmpAnimes = [...tmpAnimes, ...data.smart_box];
      }

      log("info", `douban animes.length: ${tmpAnimes.length}`);

      return tmpAnimes;
    } catch (error) {
      log("error", "getDoubanAnimes error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  async getEpisodes(id) {}

  async handleAnimes(sourceAnimes, queryTitle, curAnimes, vodName) {
    const doubanAnimes = [];

    // 添加错误处理，确保sourceAnimes是数组
    if (!sourceAnimes || !Array.isArray(sourceAnimes)) {
      log("error", "[Douban] sourceAnimes is not a valid array");
      return [];
    }

    const processDoubanAnimes = await Promise.allSettled(
      sourceAnimes.map(async (anime) => {
        try {
          if (anime?.layout !== "subject") return;
          const doubanId = anime.target_id;
          let animeType = anime?.type_name;
          if (animeType !== "电影" && animeType !== "电视剧") return;
          log("info", "doubanId: ", doubanId, anime?.target?.title, animeType);

          // 获取平台详情页面url
          const response = await getDoubanDetail(doubanId);

          const results = [];

          for (const vendor of response.data?.vendors ?? []) {
            if (!vendor) {
              continue;
            }
            log("info", "vendor uri: ", vendor.uri);

            if (response.data?.genres.includes("真人秀")) {
              animeType = "综艺";
            } else if (response.data?.genres.includes("纪录片")) {
              animeType = "纪录片";
            } else if (
              animeType === "电视剧" &&
              response.data?.genres.includes("动画") &&
              response.data?.countries.some((country) =>
                country.includes("中国")
              )
            ) {
              animeType = "国漫";
            } else if (
              animeType === "电视剧" &&
              response.data?.genres.includes("动画") &&
              response.data?.countries.includes("日本")
            ) {
              animeType = "日番";
            } else if (
              animeType === "电视剧" &&
              response.data?.genres.includes("动画")
            ) {
              animeType = "动漫";
            } else if (
              animeType === "电影" &&
              response.data?.genres.includes("动画")
            ) {
              animeType = "动画电影";
            } else if (
              animeType === "电影" &&
              response.data?.countries.some((country) =>
                country.includes("中国")
              )
            ) {
              animeType = "华语电影";
            } else if (animeType === "电影") {
              animeType = "外语电影";
            } else if (
              animeType === "电视剧" &&
              response.data?.countries.some((country) =>
                country.includes("中国")
              )
            ) {
              animeType = "国产剧";
            } else if (
              animeType === "电视剧" &&
              response.data?.countries.some((country) =>
                ["日本", "韩国"].includes(country)
              )
            ) {
              animeType = "日韩剧";
            } else if (
              animeType === "电视剧" &&
              response.data?.countries.some((country) =>
                [
                  "美国",
                  "英国",
                  "加拿大",
                  "法国",
                  "德国",
                  "意大利",
                  "西班牙",
                  "澳大利亚",
                ].includes(country)
              )
            ) {
              animeType = "欧美剧";
            }

            const tmpAnimes = [
              {
                title: response.data?.title,
                year: response.data?.year,
                type: animeType,
                imageUrl: anime?.target?.cover_url,
              },
            ];
            switch (vendor.id) {
              case "qq": {
                const cid = new URL(vendor.uri).searchParams.get("cid");
                if (cid) {
                  tmpAnimes[0].provider = "tencent";
                  tmpAnimes[0].mediaId = cid;
                  await this.tencentSource.handleAnimes(
                    tmpAnimes,
                    response.data?.title,
                    doubanAnimes
                  );
                }
                break;
              }
              case "iqiyi": {
                const tvid = new URL(vendor.uri).searchParams.get("tvid");
                if (tvid) {
                  tmpAnimes[0].provider = "iqiyi";
                  tmpAnimes[0].mediaId =
                    anime?.type_name === "电影" ? `movie_${tvid}` : tvid;
                  await this.iqiyiSource.handleAnimes(
                    tmpAnimes,
                    response.data?.title,
                    doubanAnimes
                  );
                }
                break;
              }
              case "youku": {
                const showId = new URL(vendor.uri).searchParams.get("showid");
                if (showId) {
                  tmpAnimes[0].provider = "youku";
                  tmpAnimes[0].mediaId = showId;
                  await this.youkuSource.handleAnimes(
                    tmpAnimes,
                    response.data?.title,
                    doubanAnimes
                  );
                }
                break;
              }
              case "bilibili": {
                const seasonId = new URL(vendor.uri).pathname.split("/").pop();
                if (seasonId) {
                  tmpAnimes[0].provider = "bilibili";
                  tmpAnimes[0].mediaId = `ss${seasonId}`;
                  await this.bilibiliSource.handleAnimes(
                    tmpAnimes,
                    response.data?.title,
                    doubanAnimes
                  );
                }
                break;
              }
            }
          }
          return results;
        } catch (error) {
          log("error", `[Douban] Error processing anime: ${error.message}`);
          return [];
        }
      })
    );

    this.sortAndPushAnimesByYear(doubanAnimes, curAnimes);
    return processDoubanAnimes;
  }

  async getEpisodeDanmu(id) {}

  async getDanmu(doubanId) {
    try {
      log("info", `[Douban] getDanmu (all episodes) for doubanId: ${doubanId}`);

      // 获取平台详情页面url
      const response = await getDoubanDetail(doubanId);
      if (!response || !response.data) {
        log("error", `[Douban] Failed to get detail for ${doubanId}`);
        return null;
      }

      const episodeMap = {};

      for (const vendor of response.data?.vendors ?? []) {
        if (!vendor) continue;

        let eps = [];
        let provider = "";

        // 根据不同平台获取对应的视频链接
        switch (vendor.id) {
          case "qq": {
            const cid = new URL(vendor.uri).searchParams.get("cid");
            if (cid) {
              log("info", `[Douban] Found Tencent cid: ${cid}`);
              eps = await this.tencentSource.getEpisodes(cid);
              provider = "tencent";
            }
            break;
          }
          case "iqiyi": {
            const tvid = new URL(vendor.uri).searchParams.get("tvid");
            if (tvid) {
              log("info", `[Douban] Found iQIYI tvid: ${tvid}`);
              eps = await this.iqiyiSource.getEpisodes(tvid);
              provider = "iqiyi";
            }
            break;
          }
          case "youku": {
            const showId = new URL(vendor.uri).searchParams.get("showid");
            if (showId) {
              log("info", `[Douban] Found Youku showId: ${showId}`);
              eps = await this.youkuSource.getEpisodes(showId);
              provider = "youku";
            }
            break;
          }
          case "bilibili": {
            const seasonId = new URL(vendor.uri).pathname.split("/").pop();
            if (seasonId) {
              log("info", `[Douban] Found Bilibili seasonId: ${seasonId}`);
              eps = await this.bilibiliSource.getEpisodes(`ss${seasonId}`);
              provider = "bilibili";
            }
            break;
          }
        }

        if (eps && eps.length > 0) {
          log("info", `[Douban] Found ${eps.length} episodes from ${provider}`);

          eps.forEach((ep, index) => {
            // Normalize episode number
            // Strategy:
            // 1. Try to extract number from title (e.g., "第01集" -> 1).
            // 2. Fallback to index + 1 if title parsing fails or is ambiguous.
            // User requirement: "不应该包含0前缀，例如'第01集' 应该返回'1'"

            let epNum = null;
            if (ep.title) {
              const match =
                ep.title.match(/第(\d+)集/) || ep.title.match(/(\d+)/);
              if (match) {
                epNum = parseInt(match[1], 10).toString();
              }
            }

            if (!epNum) {
              epNum = (index + 1).toString();
            }

            // Store in map if not exists (first provider wins if multiple? or simplistic overwrite?)
            // Assuming the first provider we find is good enough.
            // But we iterate vendors. If we already found episodes, maybe we should stop?
            // The original code iterated vendors and returned on first match.
            // So if we have episodes from one vendor, we can break and return this map.

            const url =
              ep.link ||
              (provider === "youku"
                ? `https://v.youku.com/v_show/id_${ep.id}.html`
                : null) ||
              (provider === "tencent"
                ? `https://v.qq.com/x/cover/${new URL(
                    vendor.uri
                  ).searchParams.get("cid")}/${ep.vid}.html`
                : null);

            if (url) {
              episodeMap[epNum] = url;
            }
          });

          // If we found episodes from this vendor, return the map.
          // This mimics the behavior of returning the first found source.
          return episodeMap;
        }
      }

      log("info", `[Douban] No videos found for doubanId: ${doubanId}`);
      return null;
    } catch (error) {
      log("error", `[Douban] getDanmu error: ${error.message}`);
      return null;
    }
  }

  formatComments(comments) {}
}
