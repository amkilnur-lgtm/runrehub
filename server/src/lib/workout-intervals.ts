// Разметка рабочих отрезков в интервальной тренировке.
//
// Готовой разметки у нас нет: intervals.icu отдаёт круги в icu_intervals с
// type='WORK' практически у всех отрезков (их детектор включается только на
// структурированных тренировках), поэтому решаем задачу сами по кругам часов.
//
// Принцип: РАЗМЕТКА идёт по локальному контрасту (блок быстрее соседнего),
// а ДОПУСК — по структуре повторов. Глобальный порог темпа не работает: в одной
// тренировке бывают 5×1200 по 3:28 и 10×200 по 3:05, между ними границы нет.
// Подсвечиваем только круги из подтверждённых серий — лучше не подсветить
// ничего, чем подсветить половину одинаковых отрезков.

export type WorkoutIntervalLap = {
  id: number;
  distance_meters: number;
  elapsed_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
  start_index?: number | null;
  end_index?: number | null;
};

export type WorkoutIntervalSet = {
  count: number;
  distance_meters: number;
  pace_seconds_per_km: number;
  moving_time_seconds: number;
  average_heartrate: number | null;
  label: string;
};

export type WorkoutIntervalSegment = {
  set_index: number;
  lap_ids: number[];
  start_index: number | null;
  end_index: number | null;
};

export type WorkoutStructure = {
  work_lap_ids: number[];
  sets: WorkoutIntervalSet[];
  segments: WorkoutIntervalSegment[];
};

const P = {
  MERGE_PACE_TOL: 0.07, // склейка соседних кругов в блок: разброс темпа
  MERGE_PACE_TOL_ABS: 20, // с/км
  MERGE_DIST_LO: 0.6,
  MERGE_DIST_HI: 1.65,
  CONTRAST_RATIO: 1.18, // рабочий блок быстрее соседнего минимум на 18%
  CONTRAST_ABS: 35, // и минимум на 35 с/км
  REST_INSIDE_SEC: 20, // стоянка внутри круга = граница повтора
  MIN_REP_METERS: 60,
  MIN_REP_SECONDS: 15,
  SET_PACE_TOL: 0.1,
  SET_PACE_TOL_ABS: 15,
  SET_DIST_LO: 0.6,
  SET_DIST_HI: 1.65,
  SET_DIST_CV: 0.3,
  SET_PACE_CV: 0.08,
  SET_PACE_VS_AVERAGE: 0.95, // серия должна быть быстрее среднего темпа тренировки
  PAIR_MIN_METERS: 400, // серия из двух повторов — только если повторы длинные
  SOLO_MIN_METERS: 800, // одиночный темповый блок: минимальная длина
  SOLO_MIN_SECONDS: 180,
  SOLO_PACE_VS_AVERAGE: 0.85, // и минимум на 15% быстрее среднего темпа тренировки
  SOLO_PACE_VS_REPEATS: 1.45, // и не сильно медленнее самой медленной серии повторов
  GROW_REACH_MIN: 2, // доращивание серии: минимальный охват в блоках
  GROW_REACH_MAX: 4,
  MAX_WORK_TIME_SHARE: 0.6,
  STUB_METERS: 200, // огрызок записи в начале/конце — не отдых и не повтор
  MICRO_METERS: 60, // мусор от двойного нажатия кнопки круга
  MICRO_SECONDS: 20,
  AUTO_KM_SHARE: 0.8, // тренировка нарезана автокругами часов
  AUTO_KM_TOLERANCE: 40,
  AUTO_KM_MIN_HR_DELTA: 8,
  MIN_LAPS: 3,
  MIN_BLOCKS: 3,
  PACE_MIN: 100, // с/км: границы правдоподобного бегового темпа
  PACE_MAX: 3000
};

type PreparedLap = {
  lap: WorkoutIntervalLap;
  position: number;
  distance: number;
  elapsed: number;
  moving: number;
  rest: number;
  pace: number;
  heartrate: number | null;
  isStub: boolean;
  isValid: boolean;
};

type Block = {
  index: number;
  laps: PreparedLap[];
  distance: number;
  moving: number;
  rest: number;
  pace: number;
  heartrate: number | null;
  isStub: boolean;
  isValid: boolean;
};

function median(values: number[]) {
  if (!values.length) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coefficientOfVariation(values: number[]) {
  if (values.length < 2) {
    return 0;
  }

  const average = values.reduce((total, value) => total + value, 0) / values.length;
  if (!average) {
    return Number.POSITIVE_INFINITY;
  }

  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / average;
}

// Круги приходят с темпом движения (average_speed) и общим временем (elapsed).
// Разница между ними — стоянка внутри круга: спортсмен нажал круг один раз на
// повтор, а отдых записался в тот же отрезок.
function prepareLaps(laps: WorkoutIntervalLap[]): PreparedLap[] {
  const mapped = laps.map((lap, position) => {
    const distance = Number(lap.distance_meters) || 0;
    const elapsed = Number(lap.elapsed_time_seconds) || 0;
    const speed = Number(lap.average_speed) || 0;
    const moving = speed > 0 ? Math.min(distance / speed, elapsed) : elapsed;
    const heartrate = Number(lap.average_heartrate) || null;

    return {
      lap,
      position,
      distance,
      elapsed,
      moving,
      rest: Math.max(0, elapsed - moving),
      pace: speed > 0 ? 1000 / speed : Number.POSITIVE_INFINITY,
      heartrate
    };
  });

  const kept = mapped.filter(
    (item) => !(item.distance < P.MICRO_METERS && item.elapsed < P.MICRO_SECONDS)
  );

  return kept.map((item, position) => ({
    ...item,
    position,
    isStub: item.distance < P.STUB_METERS && (position === 0 || position === kept.length - 1),
    isValid: Number.isFinite(item.pace) && item.pace > P.PACE_MIN && item.pace < P.PACE_MAX
  }));
}

// Подряд идущие круги с близким темпом и длиной — это один отрезок работы
// (3 км темпа, размеченные по километру). Через стоянку внутри круга не
// склеиваем: там граница повтора.
function buildBlocks(laps: PreparedLap[]): Block[] {
  const blocks: Block[] = [];

  for (const lap of laps) {
    const current = blocks[blocks.length - 1];
    const previousLap = current?.laps[current.laps.length - 1];
    const canMerge =
      current &&
      previousLap &&
      current.isValid &&
      lap.isValid &&
      current.isStub === lap.isStub &&
      previousLap.rest < P.REST_INSIDE_SEC &&
      lap.rest < P.REST_INSIDE_SEC &&
      lap.distance >= previousLap.distance * P.MERGE_DIST_LO &&
      lap.distance <= previousLap.distance * P.MERGE_DIST_HI &&
      Math.abs(lap.pace - current.pace) <=
        Math.max(P.MERGE_PACE_TOL_ABS, current.pace * P.MERGE_PACE_TOL);

    if (canMerge) {
      current.laps.push(lap);
      current.distance += lap.distance;
      current.moving += lap.moving;
      current.rest += lap.rest;
      current.pace = (current.moving / current.distance) * 1000;
      continue;
    }

    blocks.push({
      index: blocks.length,
      laps: [lap],
      distance: lap.distance,
      moving: lap.moving,
      rest: lap.rest,
      pace: lap.pace,
      heartrate: lap.heartrate,
      isStub: lap.isStub,
      isValid: lap.isValid
    });
  }

  return blocks.map((block, index) => ({
    ...block,
    index,
    heartrate: median(block.laps.map((lap) => lap.heartrate).filter((hr): hr is number => !!hr)) || null
  }));
}

// GPS меряет повтор в 400 м как 391–409, поэтому подпись притягиваем к ходовым
// дистанциям — иначе в сводке появляется «5×390 м».
const STANDARD_REP_DISTANCES = [
  100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 3000, 5000
];

function formatDistanceLabel(distanceMeters: number) {
  const snapped =
    STANDARD_REP_DISTANCES.find(
      (candidate) => Math.abs(distanceMeters - candidate) <= candidate * 0.08
    ) ?? distanceMeters;

  // километровые повторы принято писать «1000 м», а не «1 км»
  if (snapped === 1000) {
    return "1000 м";
  }

  if (snapped >= 1000) {
    const kilometers = snapped / 1000;
    const text = Number.isInteger(kilometers) ? `${kilometers}` : kilometers.toFixed(1);
    return `${text.replace(".", ",")} км`;
  }

  const step = snapped < 400 ? 10 : 50;
  return `${Math.round(snapped / step) * step} м`;
}

// Одиночный длинный блок — это темповый отрезок (2 км в темпе перед интервалами,
// километр после них). Повторов у него нет, поэтому спрашиваем строже: заметная
// длина и явный отрыв от среднего темпа тренировки.
function isSoloWorkBlock(block: Block, averagePace: number, slowestRepeatPace: number) {
  return (
    block.distance >= P.SOLO_MIN_METERS &&
    block.moving >= P.SOLO_MIN_SECONDS &&
    block.pace <= averagePace * P.SOLO_PACE_VS_AVERAGE &&
    block.pace <= slowestRepeatPace * P.SOLO_PACE_VS_REPEATS
  );
}

export function detectWorkoutIntervals(
  laps: WorkoutIntervalLap[],
  workout: { average_speed?: number | null } | null
): WorkoutStructure | null {
  const prepared = prepareLaps(laps ?? []);
  if (prepared.length < P.MIN_LAPS) {
    return null;
  }

  const allBlocks = buildBlocks(prepared);
  // Огрызок записи по краям не может быть ни повтором, ни эталоном отдыха, но
  // дорастить им подтверждённую серию можно: последнее ускорение часто обрывается
  // вместе с записью — «4×100» вместо пяти читается как ошибка.
  const blocks = allBlocks.filter((block) => block.isValid && !block.isStub);
  const growable = allBlocks.filter((block) => block.isValid);
  if (blocks.length < P.MIN_BLOCKS) {
    return null;
  }

  const workoutSpeed = Number(workout?.average_speed) || 0;
  const averagePace =
    workoutSpeed > 0 ? 1000 / workoutSpeed : median(prepared.map((lap) => lap.pace));
  if (!Number.isFinite(averagePace)) {
    return null;
  }

  const candidates = blocks.filter((block, index) => {
    if (block.distance < P.MIN_REP_METERS || block.moving < P.MIN_REP_SECONDS) {
      return false;
    }

    // A: заметно быстрее соседнего блока — отдых записан отдельным кругом
    const neighbours = [blocks[index - 1], blocks[index + 1]].filter(Boolean) as Block[];
    const hasContrast = neighbours.some(
      (neighbour) =>
        neighbour.pace / block.pace >= P.CONTRAST_RATIO &&
        neighbour.pace - block.pace >= P.CONTRAST_ABS
    );
    if (hasContrast) {
      return true;
    }

    // B: стоянка внутри круга — спортсмен жмёт круг раз на повтор, соседей для
    // сравнения нет, поэтому сверяемся со средним темпом тренировки
    return block.rest >= P.REST_INSIDE_SEC && block.pace <= averagePace / P.CONTRAST_RATIO;
  });

  if (candidates.length < 2) {
    return null;
  }

  // Серии собираем и по темпу, и по длине: иначе 5×1200 и 10×200 сливаются в одну
  const clusters: Block[][] = [];
  for (const block of [...candidates].sort((a, b) => a.pace - b.pace || a.distance - b.distance)) {
    const fit = clusters.find((cluster) => {
      const clusterPace = median(cluster.map((item) => item.pace));
      const clusterDistance = median(cluster.map((item) => item.distance));
      return (
        Math.abs(block.pace - clusterPace) <=
          Math.max(P.SET_PACE_TOL_ABS, clusterPace * P.SET_PACE_TOL) &&
        block.distance >= clusterDistance * P.SET_DIST_LO &&
        block.distance <= clusterDistance * P.SET_DIST_HI
      );
    });

    if (fit) {
      fit.push(block);
    } else {
      clusters.push([block]);
    }
  }

  const repeatSets = clusters
    .map((cluster) => cluster.sort((a, b) => a.index - b.index))
    .filter((cluster) => {
      if (cluster.length < 2) {
        return false;
      }

      const setPace = median(cluster.map((item) => item.pace));
      if (setPace > averagePace * P.SET_PACE_VS_AVERAGE) {
        return false;
      }

      const setDistance = median(cluster.map((item) => item.distance));
      if (cluster.length === 2 && setDistance < P.PAIR_MIN_METERS) {
        return false;
      }

      if (coefficientOfVariation(cluster.map((item) => item.distance)) > P.SET_DIST_CV) {
        return false;
      }

      return coefficientOfVariation(cluster.map((item) => item.pace)) <= P.SET_PACE_CV;
    });

  if (!repeatSets.length) {
    return null;
  }

  // Доращиваем подтверждённую серию соседними похожими блоками: «4 из 7
  // одинаковых отрезков подсвечены» читается как ошибка.
  for (const cluster of repeatSets) {
    let grew = true;
    while (grew) {
      grew = false;
      const clusterPace = median(cluster.map((item) => item.pace));
      const clusterDistance = median(cluster.map((item) => item.distance));
      const indexes = cluster.map((item) => item.index).sort((a, b) => a - b);
      // Дотягиваемся на шаг самой серии: в связке «800 + рывок 200 + трусца»
      // повторы идут через 3 блока, и фиксированное окно теряло первый из них.
      const steps = indexes.slice(1).map((value, position) => value - indexes[position]);
      const reach = Math.max(P.GROW_REACH_MIN, Math.min(median(steps) || 0, P.GROW_REACH_MAX));
      const from = indexes[0] - reach;
      const to = indexes[indexes.length - 1] + reach;

      for (const block of growable) {
        if (cluster.includes(block) || block.index < from || block.index > to) {
          continue;
        }

        if (
          Math.abs(block.pace - clusterPace) >
          Math.max(P.SET_PACE_TOL_ABS, clusterPace * P.SET_PACE_TOL)
        ) {
          continue;
        }

        if (
          block.distance < clusterDistance * P.SET_DIST_LO ||
          block.distance > clusterDistance * P.SET_DIST_HI
        ) {
          continue;
        }

        cluster.push(block);
        grew = true;
      }

      cluster.sort((a, b) => a.index - b.index);
    }
  }

  // Темповый отрезок рядом с интервалами (2 км в темпе до серии, километр после
  // неё). Повторов у него нет, поэтому опираемся на сами повторы: работой он
  // считается, только если бежался в темпе, сопоставимом с ними. Средний темп
  // тренировки как единственный ориентир не годится — его занижают долгие
  // прогулки между повторами, и тогда в работу попадает разминка.
  const slowestRepeatPace = Math.max(
    ...repeatSets.map((cluster) => median(cluster.map((item) => item.pace)))
  );
  const claimedByRepeats = new Set(repeatSets.flat().map((block) => block.index));
  const soloSets = clusters
    .filter((cluster) => cluster.length === 1 && !claimedByRepeats.has(cluster[0].index))
    .filter((cluster) => isSoloWorkBlock(cluster[0], averagePace, slowestRepeatPace));

  const sets = [...repeatSets, ...soloSets];

  // Соседние серии могут дорасти до одного и того же блока — тогда отрезок попал
  // бы в разметку дважды (двойная полоса на графике). Оставляем его той серии,
  // к темпу которой он ближе.
  const owners = new Map<number, Block[][]>();
  for (const cluster of sets) {
    for (const block of cluster) {
      owners.set(block.index, [...(owners.get(block.index) ?? []), cluster]);
    }
  }

  for (const [blockIndex, claimants] of owners) {
    if (claimants.length < 2) {
      continue;
    }

    const block = allBlocks.find((item) => item.index === blockIndex);
    if (!block) {
      continue;
    }

    let winner = claimants[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of claimants) {
      const gap = Math.abs(median(cluster.map((item) => item.pace)) - block.pace);
      if (gap < bestDistance) {
        bestDistance = gap;
        winner = cluster;
      }
    }

    for (const cluster of claimants) {
      if (cluster === winner) {
        continue;
      }

      const position = cluster.indexOf(block);
      if (position >= 0) {
        cluster.splice(position, 1);
      }
    }
  }

  // Серия могла потерять блок при разрешении конфликта: оставшийся одиночкой
  // блок сохраняем, только если он проходит как самостоятельный темповый отрезок.
  const survivingSets = sets.filter(
    (cluster) =>
      cluster.length >= 2 ||
      (cluster.length === 1 && isSoloWorkBlock(cluster[0], averagePace, slowestRepeatPace))
  );
  if (!survivingSets.length) {
    return null;
  }

  const workBlocks = survivingSets.flat();
  const totalMoving = prepared.reduce((total, lap) => total + lap.moving, 0) || 1;
  // Ограничение доли работы защищает от разметки обычного бега как серии повторов,
  // поэтому считаем его по сериям. Темповые блоки в него не входят: у длинной
  // темповой тренировки работа честно занимает большую часть времени, а от захвата
  // всей пробежки такой блок удерживает требование быть быстрее её среднего темпа.
  const repeatMoving = repeatSets
    .flat()
    .filter((block) => survivingSets.some((cluster) => cluster.includes(block)))
    .reduce((total, block) => total + block.moving, 0);
  if (repeatMoving / totalMoving > P.MAX_WORK_TIME_SHARE) {
    return null;
  }

  // Если всю тренировку нарезали автокруги часов, границы отрезков ставил не
  // спортсмен — разброс темпа там естественный, верим только подтверждению пульсом.
  const autoKmShare =
    prepared.filter((lap) => Math.abs(lap.distance - 1000) <= P.AUTO_KM_TOLERANCE).length /
    prepared.length;
  if (autoKmShare >= P.AUTO_KM_SHARE) {
    const workIndexes = new Set(workBlocks.map((block) => block.index));
    const workHeartRates = workBlocks
      .map((block) => block.heartrate)
      .filter((hr): hr is number => !!hr);
    const restHeartRates = blocks
      .filter((block) => !workIndexes.has(block.index))
      .map((block) => block.heartrate)
      .filter((hr): hr is number => !!hr);

    if (workHeartRates.length < 2 || restHeartRates.length < 2) {
      return null;
    }

    if (median(workHeartRates) - median(restHeartRates) < P.AUTO_KM_MIN_HR_DELTA) {
      return null;
    }
  }

  const ordered = survivingSets
    .map((cluster) => ({ cluster, first: Math.min(...cluster.map((item) => item.index)) }))
    .sort((a, b) => a.first - b.first);

  const resultSets: WorkoutIntervalSet[] = [];
  const segments: WorkoutIntervalSegment[] = [];
  const workLapIds: number[] = [];

  ordered.forEach(({ cluster }, setIndex) => {
    const setDistance = median(cluster.map((item) => item.distance));
    const setPace = median(cluster.map((item) => item.pace));
    const setHeartRates = cluster
      .map((item) => item.heartrate)
      .filter((hr): hr is number => !!hr);

    resultSets.push({
      count: cluster.length,
      distance_meters: Math.round(setDistance),
      pace_seconds_per_km: Math.round(setPace),
      moving_time_seconds: Math.round(median(cluster.map((item) => item.moving))),
      average_heartrate: setHeartRates.length ? Math.round(median(setHeartRates)) : null,
      label:
        cluster.length > 1
          ? `${cluster.length}×${formatDistanceLabel(setDistance)}`
          : formatDistanceLabel(setDistance)
    });

    for (const block of cluster) {
      const lapIds = block.laps.map((lap) => lap.lap.id);
      workLapIds.push(...lapIds);

      const startIndexes = block.laps
        .map((lap) => lap.lap.start_index)
        .filter((value): value is number => Number.isFinite(value as number));
      const endIndexes = block.laps
        .map((lap) => lap.lap.end_index)
        .filter((value): value is number => Number.isFinite(value as number));

      segments.push({
        set_index: setIndex,
        lap_ids: lapIds,
        start_index: startIndexes.length ? Math.min(...startIndexes) : null,
        end_index: endIndexes.length ? Math.max(...endIndexes) : null
      });
    }
  });

  segments.sort((a, b) => (a.start_index ?? 0) - (b.start_index ?? 0));

  return {
    work_lap_ids: workLapIds,
    sets: resultSets,
    segments
  };
}
