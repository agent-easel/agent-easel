import { expect, it } from "vite-plus/test";
import type { ConditionArrivalEvidence, ConditionArrivalPage } from "@t3-factory/contracts";
import {
  arrivalsAfterWindow,
  arrivalWindowReducer,
  emptyArrivalWindow,
  type ArrivalWindow,
  type ArrivalWindowAction,
} from "../src/condition-arrivals.ts";

const arrival = (arrivalNumber: number): ConditionArrivalEvidence => ({
  id: `arrival-${arrivalNumber}`,
  arrivalNumber,
  outputId: "otherwise",
  acceptedAt: "2026-11-16T10:00:00Z",
  sourceBlockId: "reviewer",
  origin: null,
  rule: null,
  recipients: [],
});

const page = (
  numbers: readonly number[],
  highWater: number,
  nextCursor: string | null,
): ConditionArrivalPage => ({ arrivals: numbers.map(arrival), highWater, nextCursor });

const apply = (actions: readonly ArrivalWindowAction[], from: ArrivalWindow = emptyArrivalWindow) =>
  actions.reduce(arrivalWindowReducer, from);

/** A window opened at high-water 3 whose first page holds arrivals 1 and 2. */
const openedWindow = apply([
  { type: "requested", request: 1, page: "first" },
  { type: "loaded", request: 1, page: page([1, 2], 3, "after-2") },
]);

it("Load more continues the open window in arrival order and keeps its high-water", () => {
  // Arrange
  const requested = apply([{ type: "requested", request: 2, page: "more" }], openedWindow);

  // Act
  const continued = arrivalWindowReducer(requested, {
    type: "loaded",
    request: 2,
    page: page([3], 3, null),
  });

  // Assert
  expect(continued.arrivals.map((item) => item.arrivalNumber)).toStrictEqual([1, 2, 3]);
  expect(continued.highWater).toBe(3);
  expect(continued.nextCursor).toBeNull();
});

it("a Load more answer arriving after a refresh is dropped, so the new window never mixes in the old one", () => {
  // Arrange
  const refreshing = apply(
    [
      { type: "requested", request: 2, page: "more" },
      { type: "requested", request: 3, page: "first" },
      { type: "loaded", request: 3, page: page([1, 2], 5, "after-2") },
    ],
    openedWindow,
  );

  // Act
  const late = arrivalWindowReducer(refreshing, {
    type: "loaded",
    request: 2,
    page: page([3], 3, null),
  });

  // Assert
  expect(late.arrivals.map((item) => item.arrivalNumber)).toStrictEqual([1, 2]);
  expect(late.highWater).toBe(5);
  expect(late.nextCursor).toBe("after-2");
});

it("a failed Load more keeps the window and its cursor so the same page can be read again", () => {
  // Arrange
  const requested = apply([{ type: "requested", request: 2, page: "more" }], openedWindow);

  // Act
  const failed = arrivalWindowReducer(requested, {
    type: "failed",
    request: 2,
    message: "This cursor does not continue this Condition's arrivals in this Run.",
  });

  // Assert
  expect(failed).toStrictEqual({
    ...openedWindow,
    request: 2,
    error: {
      message: "This cursor does not continue this Condition's arrivals in this Run.",
      during: "more",
    },
  });
});

it("arrivals the live summary counts beyond the window's high-water are offered for refresh", () => {
  // Arrange
  const summaryArrivals = 5;

  // Act
  const newer = arrivalsAfterWindow(openedWindow, summaryArrivals);

  // Assert
  expect(newer).toBe(2);
});
