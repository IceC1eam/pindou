/* 色板数据。
 * 这里是通用色板：颜色是按常见拼豆色系估的近似值，编号 P01… 是本应用自己的占位编号，
 * 并不对应任何品牌（Perler / Hama / MARD 等）的官方色号。
 * 要换成自己手里那一套豆子的真实色卡：按同样格式新增一个 palette 对象即可，界面会自动出现。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PindouPalettes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // [名称, 色值, 是否属于“基础”子集]
  const RAW = [
    ["白", "#FFFFFF", 1], ["米白", "#F3EBDD"], ["浅灰", "#D0D0D0", 1], ["灰", "#9A9A9A"], ["深灰", "#5A5A5A", 1], ["黑", "#1A1A1A", 1],
    ["浅粉", "#F9D0D8", 1], ["粉", "#F29BB5"], ["玫红", "#E0457B", 1], ["红", "#D8262C", 1], ["深红", "#9E1B24"], ["酒红", "#6E1A2B"],
    ["浅橙", "#F9C58A"], ["橙", "#F28A21", 1], ["深橙", "#D2601A"], ["浅黄", "#FBEA8C", 1], ["黄", "#F6CE2A", 1], ["金黄", "#D9A21B"],
    ["浅绿", "#C5E6A6"], ["草绿", "#7CC24A", 1], ["绿", "#2E9E4F", 1], ["深绿", "#1D6B3A"], ["墨绿", "#174A34"], ["青绿", "#4DBFA0"], ["薄荷", "#A6E3D0"],
    ["浅蓝", "#A9D6F2", 1], ["天蓝", "#4DA9E6", 1], ["蓝", "#2C6FC4", 1], ["深蓝", "#1F3F8F"], ["藏青", "#162A5A", 1], ["青", "#1BA3B8"], ["浅青", "#8FD6DE"],
    ["浅紫", "#D2B8E6"], ["紫", "#9A5FC4", 1], ["深紫", "#5C2F8C"], ["薰衣草", "#B7A8E8"],
    ["肤色", "#F5CBA7", 1], ["杏色", "#E8B98A"], ["浅棕", "#D9A066", 1], ["棕", "#A8683A"], ["深棕", "#6B3F22", 1], ["咖啡", "#43271A"],
    ["卡其", "#B9A46C"], ["橄榄", "#7F7A2E"], ["荧光黄绿", "#D4E84A"], ["荧光粉", "#FF5FA2"], ["蓝灰", "#7C93A8"], ["灰粉", "#C9A3A6"],
  ];

  const ALL = RAW.map(([name, hex, basic], i) => ({
    code: "P" + String(i + 1).padStart(2, "0"), name, hex, basic: !!basic,
  }));

  const palettes = [
    { id: "basic", name: "基础 " + ALL.filter((c) => c.basic).length + " 色", colors: ALL.filter((c) => c.basic) },
    { id: "full", name: "通用 " + ALL.length + " 色", colors: ALL },
  ];

  return { palettes, byId: (id) => palettes.find((p) => p.id === id) || palettes[0] };
});
