import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  formatDoubanDanmuResponse,
  postProcessDanmu,
} from "./douban-api.js";

describe("douban-api response formatting", () => {
  const danmuData = {
    errorCode: 0,
    url: "https://v.qq.com/example",
    count: 2,
    comments: [
      {p: "12.5,1,16777215,[qq]", m: "scrolling"},
      {p: "20,5,255,[qq]", m: "bottom"},
    ],
  };

  it("converts comments to the douban endpoint JSON shape", () => {
    assert.deepEqual(postProcessDanmu(danmuData), {
      code: 0,
      name: "https://v.qq.com/example",
      danum: 2,
      danmuku: [
        [12.5, "right", "#FFFFFF", "25px", "scrolling"],
        [20, "bottom", "#0000FF", "25px", "bottom"],
      ],
    });
  });

  it("only applies the custom conversion to JSON responses", async () => {
    const jsonResponse = new Response(JSON.stringify(danmuData), {
      headers: {"Content-Type": "application/json"},
    });
    const converted = await formatDoubanDanmuResponse(jsonResponse, "json");
    assert.deepEqual(await converted.json(), postProcessDanmu(danmuData));

    const xmlResponse = new Response("<?xml version=\"1.0\"?><i></i>");
    assert.equal(await formatDoubanDanmuResponse(xmlResponse, "xml"), xmlResponse);
  });
});
