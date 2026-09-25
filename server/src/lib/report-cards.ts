import fs from "node:fs";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

// Карточки-картинки для Telegram: итоги недели/месяца и пробежка.
// satori верстает флексбокс-разметку в SVG, resvg растеризует в PNG —
// без браузера, работает и в alpine-контейнере.
// Пропорции держим не выше ~4:5: более вытянутое фото Telegram показывает
// узкой полосой с размытыми полями по бокам.

const require = createRequire(import.meta.url);

type FontWeight = 500 | 600 | 700 | 800;
type Font = { name: string; data: Buffer; weight: FontWeight; style: "normal" };

function loadFonts(): Font[] {
  const fonts: Font[] = [];
  const add = (name: string, pkg: string, file: string, weight: FontWeight) => {
    // кириллица и латиница (с цифрами) в fontsource — отдельные файлы. Под одним
    // именем satori берёт первый и не ищет глиф дальше, поэтому имена разные,
    // а в стилях — список «Имя, Имя Cyr»
    for (const [subset, fontName] of [["latin", name], ["cyrillic", `${name} Cyr`]] as const) {
      const path = require.resolve(`@fontsource/${pkg}/files/${file}-${subset}-${weight}-normal.woff`);
      fonts.push({ name: fontName, data: fs.readFileSync(path), weight, style: "normal" });
    }
  };
  add("Unbounded", "unbounded", "unbounded", 800);
  add("Manrope", "manrope", "manrope", 500);
  add("Manrope", "manrope", "manrope", 700);
  return fonts;
}

let cachedFonts: Font[] | null = null;
function fonts() {
  cachedFonts ??= loadFonts();
  return cachedFonts;
}

const DISPLAY_FONT = "Unbounded, Unbounded Cyr";
const TEXT_FONT = "Manrope, Manrope Cyr";

const WIDTH = 1080;
const PAD = 56;
const GAP = 24;
const CONTENT_WIDTH = WIDTH - PAD * 2;

const COLOR = {
  bg: "#000000",
  tile: "#1c1c1e",
  text: "#ffffff",
  muted: "#8e8e93",
  icon: "#8a8f98",
  accent: "#e5463a",
  zones: ["#5b8def", "#34c77b", "#f5b440", "#e5463a"]
};

type Node = { type: string; props: Record<string, unknown> };
type Child = Node | string | null | false;

function h(type: string, props: Record<string, unknown> | null, ...children: Child[]): Node {
  const list = children.filter((child): child is Node | string => Boolean(child));
  // satori требует явный display у div с несколькими детьми — ставим flex по умолчанию
  const style = props?.style as Record<string, unknown> | undefined;
  const nextProps =
    type === "div" && !style?.display ? { ...props, style: { display: "flex", ...style } } : props;
  return {
    type,
    props: { ...nextProps, children: list.length === 1 ? list[0] : list }
  };
}

// Иконки lucide (24×24, обводка) — как на карточках в приложении
const ICONS: Record<string, Child[]> = {
  distance: [
    h("path", { d: "M18 8l4 4-4 4" }),
    h("path", { d: "M2 12h20" }),
    h("path", { d: "M6 8l-4 4 4 4" })
  ],
  time: [
    h("line", { x1: 10, x2: 14, y1: 2, y2: 2 }),
    h("line", { x1: 12, x2: 15, y1: 14, y2: 11 }),
    h("circle", { cx: 12, cy: 14, r: 8 })
  ],
  pace: [
    h("path", {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
    })
  ],
  heart: [
    h("path", {
      d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
    })
  ],
  calories: [
    h("path", {
      d: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
    })
  ],
  workouts: [
    h("path", {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
    })
  ],
  elevation: [h("path", { d: "m8 3 4 8 5-5 5 15H2L8 3z" })]
};

function icon(name: keyof typeof ICONS, size: number) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: COLOR.icon,
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    },
    ...ICONS[name]!
  );
}

export type StatTile = { value: string; unit: string | null; label: string; icon: keyof typeof ICONS };

// Замер Unbounded 800: цифра ~0.84em, двоеточие/точка ~0.4em, прочее ~0.9em
function displayTextEm(text: string) {
  let em = 0;
  for (const char of text) {
    em += /[0-9]/.test(char) ? 0.84 : /[:.]/.test(char) ? 0.4 : 0.9;
  }
  return Math.max(em, 1);
}

// Manrope 500: в среднем ~0.56em на символ
function textWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.56;
}

function fitFont(text: string, maxWidth: number, maxSize: number) {
  return Math.min(maxSize, Math.floor(maxWidth / displayTextEm(text)));
}

// Крупная плитка (итоги, 2 колонки): число, под ним «единица · подпись», иконка справа
function wideTile(stat: StatTile, width: number) {
  const valueBox = width - 40 - 36 - 44 - 16;
  const fontSize = fitFont(stat.value, valueBox, 84);
  return h(
    "div",
    {
      style: {
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height: 200,
        padding: "36px 36px 34px 40px",
        borderRadius: 44,
        backgroundColor: COLOR.tile,
        position: "relative"
      }
    },
    h("div", { style: { position: "absolute", top: 38, right: 36 } }, icon(stat.icon, 44)),
    h(
      "div",
      { style: { height: 84, alignItems: "center" } },
      h(
        "div",
        { style: { fontFamily: DISPLAY_FONT, fontSize, lineHeight: 1, letterSpacing: -2, color: COLOR.text } },
        stat.value
      )
    ),
    h(
      "div",
      { style: { fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 30, color: COLOR.muted } },
      stat.unit ? `${stat.unit} · ${stat.label}` : stat.label
    )
  );
}

// Компактная плитка (пробежка, 3 колонки): сверху иконка и подпись, ниже число с единицей
function compactTile(stat: StatTile, width: number) {
  const inner = width - 32 - 28;
  const unitSize = 24;
  const unitWidth = stat.unit ? textWidth(stat.unit, unitSize) + 10 : 0;
  const fontSize = fitFont(stat.value, inner - unitWidth, 66);
  return h(
    "div",
    {
      style: {
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height: 178,
        padding: "28px 28px 30px 32px",
        borderRadius: 40,
        backgroundColor: COLOR.tile
      }
    },
    h(
      "div",
      { style: { alignItems: "center" } },
      icon(stat.icon, 30),
      h(
        "div",
        { style: { fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 26, color: COLOR.muted, marginLeft: 10 } },
        stat.label
      )
    ),
    h(
      "div",
      { style: { alignItems: "flex-end", height: 66 } },
      h(
        "div",
        { style: { fontFamily: DISPLAY_FONT, fontSize, lineHeight: 1, letterSpacing: -1.5, color: COLOR.text } },
        stat.value
      ),
      stat.unit
        ? h(
            "div",
            {
              style: {
                fontFamily: TEXT_FONT,
                fontWeight: 700,
                fontSize: unitSize,
                color: COLOR.muted,
                marginLeft: 10,
                marginBottom: 2
              }
            },
            stat.unit
          )
        : null
    )
  );
}

function tileGrid(stats: StatTile[], columns: 2 | 3) {
  const width = Math.floor((CONTENT_WIDTH - GAP * (columns - 1)) / columns);
  return h(
    "div",
    { style: { flexWrap: "wrap", gap: GAP, width: CONTENT_WIDTH } },
    ...stats.map((stat) => (columns === 2 ? wideTile(stat, width) : compactTile(stat, width)))
  );
}

// Имя спортсмена — крупно (его ищут глазами в общем чате), ниже «Итоги · Сентябрь»
function header(kicker: string, title: string, athleteName: string) {
  const titleText = `${kicker} · ${title}`;
  const titleSize = fitFont(titleText, CONTENT_WIDTH, 50);
  const nameSize = Math.min(56, Math.floor(CONTENT_WIDTH / Math.max(athleteName.length * 0.62, 1)));
  return h(
    "div",
    { style: { flexDirection: "column", marginBottom: 28 } },
    h(
      "div",
      { style: { fontFamily: TEXT_FONT, fontWeight: 700, fontSize: nameSize, lineHeight: 1.1, color: COLOR.text } },
      athleteName
    ),
    h(
      "div",
      {
        style: {
          alignItems: "center",
          fontFamily: DISPLAY_FONT,
          fontSize: titleSize,
          lineHeight: 1.1,
          color: COLOR.muted,
          marginTop: 14
        }
      },
      kicker,
      h("div", {
        style: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR.accent, margin: "6px 18px 0" }
      }),
      h("div", { style: { color: COLOR.text } }, title)
    )
  );
}

export type ZonePercentages = {
  under130: number;
  from130To150: number;
  from150To162: number;
  from162Plus: number;
};

function zonesBlock(zones: ZonePercentages) {
  const items = [
    { label: "до 130", value: zones.under130 },
    { label: "130–150", value: zones.from130To150 },
    { label: "150–162", value: zones.from150To162 },
    { label: "162+", value: zones.from162Plus }
  ];
  return h(
    "div",
    {
      style: {
        flexDirection: "column",
        marginTop: GAP,
        padding: "24px 40px 26px",
        borderRadius: 40,
        backgroundColor: COLOR.tile
      }
    },
    h(
      "div",
      { style: { justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
      h("div", { style: { fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 28, color: COLOR.muted } }, "зоны пульса")
    ),
    h(
      "div",
      { style: { height: 18, borderRadius: 9, overflow: "hidden", backgroundColor: "#2c2c2e" } },
      ...items.map((item, index) =>
        item.value > 0
          ? h("div", { style: { width: `${item.value}%`, height: 18, backgroundColor: COLOR.zones[index] } })
          : null
      )
    ),
    h(
      "div",
      { style: { justifyContent: "space-between", marginTop: 16 } },
      ...items.map((item, index) =>
        h(
          "div",
          { style: { alignItems: "center" } },
          h("div", {
            style: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLOR.zones[index], marginRight: 10 }
          }),
          h(
            "div",
            { style: { fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 24, color: COLOR.muted, marginRight: 10 } },
            item.label
          ),
          h("div", { style: { fontFamily: DISPLAY_FONT, fontSize: 30, color: COLOR.text } }, `${item.value}%`)
        )
      )
    )
  );
}

// Подпись бренда: RUNNING белым, REHAB фирменным красным, адрес справа
function footer() {
  return h(
    "div",
    {
      style: {
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 24,
        paddingTop: 22,
        borderTop: "2px solid #1c1c1e"
      }
    },
    h(
      "div",
      { style: { alignItems: "center", fontFamily: DISPLAY_FONT, fontSize: 28, letterSpacing: 5 } },
      h("div", { style: { width: 13, height: 13, borderRadius: 7, backgroundColor: COLOR.accent, marginRight: 16 } }),
      h("div", { style: { color: COLOR.text } }, "RUNNING"),
      h("div", { style: { color: COLOR.accent, marginLeft: 14 } }, "REHAB")
    ),
    h(
      "div",
      { style: { fontFamily: TEXT_FONT, fontWeight: 700, fontSize: 24, color: "#636366", letterSpacing: 1 } },
      "runrehab.ru"
    )
  );
}

// --- Карта под треком ---
// Тот же подход, что у RouteStaticMap на сайте: мозаика растровых тайлов в
// проекции Web Mercator, трек в тех же координатах поверх. Тайл 512 px на
// масштабе карточки — крупные подписи, читаются на телефоне.

const MAP_TILE = 512;
const ROUTE_CASING = "#181b26";
const MAP_MAX_ZOOM = 17;
const MAP_FETCH_TIMEOUT_MS = 6000;

function mercator(lat: number, lng: number) {
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  };
}

// Только MapTiler (ключ тот же, что у карты на сайте). Без ключа карты нет:
// CARTO больше не отдаёт тайлы без ключа — вместо карты приходит заглушка
function mapTileUrl(z: number, x: number, y: number) {
  const apiKey = process.env.VITE_MAP_API_KEY?.trim();
  return apiKey ? `https://api.maptiler.com/maps/streets-v2-dark/256/${z}/${x}/${y}@2x.png?key=${apiKey}` : null;
}

async function fetchTile(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(MAP_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "RunRehab report cards (runrehab.ru)" }
  });
  if (!response.ok) {
    throw new Error(`MAP_TILE_FAILED ${response.status}`);
  }
  return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

type RouteLayout = {
  d: string;
  start: [number, number];
  finish: [number, number];
  tiles: Array<{ src: string; left: number; top: number; size: number }>;
};

async function layoutRoute(
  points: Array<[number, number]>,
  width: number,
  height: number,
  inset: number,
  withMap: boolean
): Promise<RouteLayout> {
  const step = Math.max(1, Math.floor(points.length / 700));
  const sampled = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  const projected = sampled.map(([lat, lng]) => mercator(lat, lng));
  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));

  // масштаб, при котором трек целиком влезает с отступом; зум дробный:
  // тайлы ближайшего меньшего зума растягиваем (до 2×), трек занимает весь блок
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const fitScale = Math.min((width - inset * 2) / spanX, (height - inset * 2) / spanY);
  const worldSize = Math.min(fitScale, MAP_TILE * 2 ** MAP_MAX_ZOOM);
  const zoom = Math.max(1, Math.min(MAP_MAX_ZOOM, Math.floor(Math.log2(worldSize / MAP_TILE))));
  const tileSize = worldSize / 2 ** zoom;

  const centerX = ((minX + maxX) / 2) * worldSize;
  const centerY = ((minY + maxY) / 2) * worldSize;
  const originX = centerX - width / 2;
  const originY = centerY - height / 2;

  const coords = projected.map(
    (p) =>
      [Number((p.x * worldSize - originX).toFixed(1)), Number((p.y * worldSize - originY).toFixed(1))] as [
        number,
        number
      ]
  );
  const d = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");

  const tiles: RouteLayout["tiles"] = [];
  if (withMap && mapTileUrl(0, 0, 0)) {
    const maxIndex = 2 ** zoom - 1;
    const firstX = Math.floor(originX / tileSize);
    const lastX = Math.floor((originX + width) / tileSize);
    const firstY = Math.floor(originY / tileSize);
    const lastY = Math.floor((originY + height) / tileSize);
    const jobs: Array<Promise<void>> = [];
    for (let tx = firstX; tx <= lastX; tx += 1) {
      for (let ty = firstY; ty <= lastY; ty += 1) {
        if (ty < 0 || ty > maxIndex) {
          continue;
        }
        const wrappedX = ((tx % (maxIndex + 1)) + maxIndex + 1) % (maxIndex + 1);
        // +1px перекрытия, чтобы между растянутыми тайлами не просвечивали швы
        const left = Math.floor(tx * tileSize - originX);
        const top = Math.floor(ty * tileSize - originY);
        const size = Math.ceil(tileSize) + 1;
        jobs.push(
          fetchTile(mapTileUrl(zoom, wrappedX, ty)!).then((src) => {
            tiles.push({ src, left, top, size });
          })
        );
      }
    }
    await Promise.all(jobs);
  }

  return { d, start: coords[0]!, finish: coords[coords.length - 1]!, tiles };
}

async function routeBlock(points: Array<[number, number]>) {
  const width = CONTENT_WIDTH;
  const height = 290;
  let layout: RouteLayout;
  try {
    layout = await layoutRoute(points, width, height, 56, true);
  } catch {
    // тайлы не скачались — рисуем трек на однотонном фоне, карточка важнее карты
    layout = await layoutRoute(points, width, height, 56, false);
  }
  const hasMap = layout.tiles.length > 0;
  return h(
    "div",
    {
      style: {
        width,
        height,
        marginBottom: GAP,
        borderRadius: 40,
        backgroundColor: COLOR.tile,
        overflow: "hidden",
        position: "relative"
      }
    },
    ...layout.tiles.map((tile) =>
      h("img", {
        src: tile.src,
        width: tile.size,
        height: tile.size,
        style: { position: "absolute", left: tile.left, top: tile.top, width: tile.size, height: tile.size }
      })
    ),
    h(
      "svg",
      { width, height, viewBox: `0 0 ${width} ${height}`, style: { position: "absolute", left: 0, top: 0 } },
      // сплошная тёмная обводка, как у карты на сайте в тёмной теме (WorkoutRouteMap);
      // без карты — мягкое свечение, чтобы линия не терялась на однотонном фоне
      hasMap
        ? h("path", { d: layout.d, fill: "none", stroke: ROUTE_CASING, strokeWidth: 12, strokeLinecap: "round", strokeLinejoin: "round" })
        : h("path", { d: layout.d, fill: "none", stroke: COLOR.accent, strokeOpacity: 0.22, strokeWidth: 20, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("path", { d: layout.d, fill: "none", stroke: COLOR.accent, strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("circle", { cx: layout.start[0], cy: layout.start[1], r: 14, fill: "#ffffff" }),
      h("circle", { cx: layout.start[0], cy: layout.start[1], r: 8, fill: "#34c77b" }),
      h("circle", { cx: layout.finish[0], cy: layout.finish[1], r: 14, fill: "#ffffff" }),
      h("circle", { cx: layout.finish[0], cy: layout.finish[1], r: 8, fill: COLOR.accent })
    ),
    hasMap
      ? h(
          "div",
          {
            style: {
              position: "absolute",
              right: 18,
              bottom: 12,
              fontFamily: TEXT_FONT,
              fontWeight: 500,
              fontSize: 16,
              color: "rgba(255,255,255,0.45)"
            }
          },
          "© MapTiler © OpenStreetMap"
        )
      : null
  );
}

async function render(children: Child[]) {
  const tree = h(
    "div",
    {
      style: {
        flexDirection: "column",
        width: WIDTH,
        padding: `${PAD}px ${PAD}px ${PAD - 16}px`,
        backgroundColor: COLOR.bg
      }
    },
    ...children
  );
  // высоту satori считает по содержимому: карточка растёт вместе с блоками
  const svg = await satori(tree as never, { width: WIDTH, fonts: fonts() });
  // 2× для чёткости: Telegram всё равно пережмёт, но текст останется резким
  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH * 2 } }).render().asPng();
}

// --- форматирование ---

function formatKm(meters: number) {
  return (Math.max(0, meters) / 1000).toFixed(2);
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatPaceValue(speed: number | null) {
  if (!speed || !Number.isFinite(speed) || speed <= 0) {
    return "—";
  }
  const secondsPerKm = Math.round(1000 / speed);
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, "0")}`;
}

function formatHeartRate(value: number | null) {
  return value && Number.isFinite(value) && value > 0 ? String(Math.round(value)) : "—";
}

function hasZones(zones: ZonePercentages | null): zones is ZonePercentages {
  return Boolean(zones) && zones!.under130 + zones!.from130To150 + zones!.from150To162 + zones!.from162Plus > 0;
}

// Калорий у старых тренировок нет (Strava-архив) — тогда показываем набор высоты
function energyOrElevationTile(calories: number | null, elevationGain: number): StatTile {
  if (calories && calories > 0) {
    return { value: String(Math.round(calories)), unit: "ккал", label: "калории", icon: "calories" };
  }
  return { value: String(Math.round(elevationGain)), unit: "м", label: "набор", icon: "elevation" };
}

export type PeriodCardInput = {
  athleteName: string;
  title: string;
  totalDistanceMeters: number;
  totalMovingTimeSeconds: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  totalCalories: number | null;
  totalElevationGain: number;
  workoutCount: number;
  zonePercentages: ZonePercentages | null;
};

export async function renderPeriodCard(input: PeriodCardInput) {
  const stats: StatTile[] = [
    { value: formatKm(input.totalDistanceMeters), unit: "км", label: "расстояние", icon: "distance" },
    { value: formatClock(input.totalMovingTimeSeconds), unit: null, label: "время", icon: "time" },
    { value: formatPaceValue(input.averageSpeed), unit: "мин/км", label: "темп", icon: "pace" },
    { value: formatHeartRate(input.averageHeartrate), unit: "уд/мин", label: "пульс", icon: "heart" },
    energyOrElevationTile(input.totalCalories, input.totalElevationGain),
    { value: String(input.workoutCount), unit: null, label: pluralWorkouts(input.workoutCount), icon: "workouts" }
  ];
  const zones = hasZones(input.zonePercentages) ? input.zonePercentages : null;
  return render([
    header("Итоги", input.title, input.athleteName),
    tileGrid(stats, 2),
    zones ? zonesBlock(zones) : null,
    footer()
  ]);
}

function pluralWorkouts(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "тренировка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "тренировки";
  return "тренировок";
}

export type WorkoutCardInput = {
  athleteName: string;
  dateLabel: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  elevationGain: number;
  calories: number | null;
  averageCadence: number | null;
  maxHeartrate: number | null;
  route: Array<[number, number]> | null;
  zonePercentages: ZonePercentages | null;
};

export async function renderWorkoutCard(input: WorkoutCardInput) {
  const route = input.route && input.route.length >= 2 ? input.route : null;
  // шестая плитка — что есть: набор (если калории заняли пятую), каденс, макс. пульс
  const lastTile: StatTile =
    input.calories && input.calories > 0
      ? { value: String(Math.round(input.elevationGain)), unit: "м", label: "набор", icon: "elevation" }
      : input.averageCadence && input.averageCadence > 0
        ? { value: String(Math.round(input.averageCadence)), unit: "шаг/мин", label: "каденс", icon: "workouts" }
        : { value: formatHeartRate(input.maxHeartrate), unit: "уд/мин", label: "макс. пульс", icon: "heart" };
  const stats: StatTile[] = [
    { value: formatKm(input.distanceMeters), unit: "км", label: "дистанция", icon: "distance" },
    { value: formatClock(input.movingTimeSeconds), unit: null, label: "время", icon: "time" },
    { value: formatPaceValue(input.averageSpeed), unit: "/км", label: "темп", icon: "pace" },
    { value: formatHeartRate(input.averageHeartrate), unit: "уд/мин", label: "пульс", icon: "heart" },
    energyOrElevationTile(input.calories, input.elevationGain),
    lastTile
  ];
  const zones = hasZones(input.zonePercentages) ? input.zonePercentages : null;
  return render([
    header("Пробежка", input.dateLabel, input.athleteName),
    route ? await routeBlock(route) : null,
    tileGrid(stats, 3),
    zones ? zonesBlock(zones) : null,
    footer()
  ]);
}
