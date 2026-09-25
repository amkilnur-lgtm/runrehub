import fs from "node:fs";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

// Карточки-картинки для Telegram: итоги недели/месяца и пробежка.
// satori верстает флексбокс-разметку в SVG, resvg растеризует в PNG —
// без браузера, работает и в alpine-контейнере.

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
const GAP = 28;
const TILE_WIDTH = (WIDTH - PAD * 2 - GAP) / 2;

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

function icon(name: keyof typeof ICONS) {
  return h(
    "svg",
    {
      width: 52,
      height: 52,
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

function tile(stat: StatTile) {
  // длинные значения (2:00:39) ужимаем, чтобы не наезжали на иконку:
  // до иконки ~312px; замер: цифра Unbounded 800 ~0.84em, двоеточие/точка ~0.4em
  const narrow = (stat.value.match(/[:.]/g) ?? []).length;
  const emWidth = (stat.value.length - narrow) * 0.84 + narrow * 0.4;
  const fontSize = Math.min(88, Math.floor(312 / Math.max(emWidth, 1)));
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: TILE_WIDTH,
        height: 236,
        padding: "44px 40px 0 46px",
        borderRadius: 48,
        backgroundColor: COLOR.tile,
        position: "relative"
      }
    },
    h("div", { style: { display: "flex", position: "absolute", top: 50, right: 40 } }, icon(stat.icon)),
    h(
      "div",
      {
        style: {
          fontFamily: DISPLAY_FONT,
          fontSize,
          lineHeight: 1,
          letterSpacing: -2,
          color: COLOR.text,
          marginTop: (88 - fontSize) / 2
        }
      },
      stat.value
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: TEXT_FONT,
          fontWeight: 500,
          fontSize: 34,
          color: COLOR.muted,
          marginTop: 30 + (88 - fontSize) / 2
        }
      },
      stat.unit ? `${stat.unit} · ${stat.label}` : stat.label
    )
  );
}

function tileGrid(stats: StatTile[]) {
  return h(
    "div",
    { style: { display: "flex", flexWrap: "wrap", gap: GAP, width: WIDTH - PAD * 2 } },
    ...stats.map(tile)
  );
}

function header(kicker: string, title: string, subtitle: string | null) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", marginBottom: 48 } },
    subtitle
      ? h(
          "div",
          {
            style: {
              fontFamily: TEXT_FONT,
              fontWeight: 700,
              fontSize: 32,
              color: COLOR.muted,
              marginBottom: 18,
              letterSpacing: 0.5
            }
          },
          subtitle
        )
      : null,
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          fontFamily: DISPLAY_FONT,
          fontSize: 62,
          lineHeight: 1.1,
          color: COLOR.text
        }
      },
      kicker,
      h("div", {
        style: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLOR.muted, margin: "8px 22px 0" }
      }),
      title
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
        display: "flex",
        flexDirection: "column",
        marginTop: GAP,
        padding: "40px 46px",
        borderRadius: 48,
        backgroundColor: COLOR.tile
      }
    },
    h(
      "div",
      { style: { fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 34, color: COLOR.muted, marginBottom: 28 } },
      "зоны пульса"
    ),
    h(
      "div",
      { style: { display: "flex", height: 22, borderRadius: 11, overflow: "hidden", backgroundColor: "#2c2c2e" } },
      ...items
        .map((item, index) =>
          item.value > 0
            ? h("div", { style: { width: `${item.value}%`, height: 22, backgroundColor: COLOR.zones[index] } })
            : null
        )
    ),
    h(
      "div",
      { style: { display: "flex", justifyContent: "space-between", marginTop: 30 } },
      ...items.map((item, index) =>
        h(
          "div",
          { style: { display: "flex", flexDirection: "column" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 28, color: COLOR.muted } },
            h("div", {
              style: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLOR.zones[index], marginRight: 12 }
            }),
            item.label
          ),
          h(
            "div",
            { style: { fontFamily: DISPLAY_FONT, fontSize: 40, color: COLOR.text, marginTop: 12 } },
            `${item.value}%`
          )
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
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 44,
        paddingTop: 36,
        borderTop: "2px solid #1c1c1e"
      }
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", fontFamily: DISPLAY_FONT, fontSize: 30, letterSpacing: 5 } },
      h("div", { style: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLOR.accent, marginRight: 18 } }),
      h("div", { style: { color: COLOR.text } }, "RUNNING"),
      h("div", { style: { color: COLOR.accent, marginLeft: 16 } }, "REHAB")
    ),
    h(
      "div",
      { style: { fontFamily: TEXT_FONT, fontWeight: 700, fontSize: 26, color: "#636366", letterSpacing: 1 } },
      "runrehab.ru"
    )
  );
}

// Трек: проекция «плоская Земля» с поправкой на широту — для пробежки хватает
function routeSvgPath(points: Array<[number, number]>, width: number, height: number, inset: number) {
  const step = Math.max(1, Math.floor(points.length / 600));
  const sampled = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  const midLat = sampled.reduce((sum, [lat]) => sum + lat, 0) / sampled.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = sampled.map(([, lng]) => lng * kx);
  const ys = sampled.map(([lat]) => -lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min((width - inset * 2) / spanX, (height - inset * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const coords = xs.map((x, index) => [
    Number((offsetX + (x - minX) * scale).toFixed(1)),
    Number((offsetY + (ys[index]! - minY) * scale).toFixed(1))
  ]);
  const d = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  return { d, start: coords[0]!, finish: coords[coords.length - 1]! };
}

function routeBlock(points: Array<[number, number]>) {
  const width = WIDTH - PAD * 2;
  const height = 520;
  const { d, start, finish } = routeSvgPath(points, width, height, 64);
  return h(
    "div",
    {
      style: {
        display: "flex",
        width,
        height,
        marginBottom: GAP,
        borderRadius: 48,
        backgroundColor: COLOR.tile,
        overflow: "hidden"
      }
    },
    h(
      "svg",
      { width, height, viewBox: `0 0 ${width} ${height}` },
      // мягкое свечение под линией
      h("path", { d, fill: "none", stroke: COLOR.accent, strokeOpacity: 0.22, strokeWidth: 26, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("path", { d, fill: "none", stroke: COLOR.accent, strokeWidth: 9, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("circle", { cx: start[0], cy: start[1], r: 15, fill: "#ffffff" }),
      h("circle", { cx: start[0], cy: start[1], r: 8, fill: "#34c77b" }),
      h("circle", { cx: finish[0], cy: finish[1], r: 15, fill: "#ffffff" }),
      h("circle", { cx: finish[0], cy: finish[1], r: 8, fill: COLOR.accent })
    )
  );
}

async function render(children: Child[]) {
  const tree = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: WIDTH,
        padding: `${PAD + 8}px ${PAD}px ${PAD - 8}px`,
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
  return render(
    [header("Итоги", input.title, input.athleteName), tileGrid(stats), zones ? zonesBlock(zones) : null, footer()]
  );
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
    { value: formatKm(input.distanceMeters), unit: "км", label: "расстояние", icon: "distance" },
    { value: formatClock(input.movingTimeSeconds), unit: null, label: "время", icon: "time" },
    { value: formatPaceValue(input.averageSpeed), unit: "мин/км", label: "темп", icon: "pace" },
    { value: formatHeartRate(input.averageHeartrate), unit: "уд/мин", label: "пульс", icon: "heart" },
    energyOrElevationTile(input.calories, input.elevationGain),
    lastTile
  ];
  const zones = hasZones(input.zonePercentages) ? input.zonePercentages : null;
  return render(
    [
      header("Пробежка", input.dateLabel, input.athleteName),
      route ? routeBlock(route) : null,
      tileGrid(stats),
      zones ? zonesBlock(zones) : null,
      footer()
    ]
  );
}
