"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  classifyEvent,
  hasTemperatureReading,
  isElevatedTemperature,
} = require("../screening-model");

test("temperature readings must be finite numbers", () => {
  assert.equal(hasTemperatureReading(36.6), true);
  assert.equal(hasTemperatureReading(null), false);
  assert.equal(hasTemperatureReading(Number.NaN), false);
  assert.equal(hasTemperatureReading(Number.POSITIVE_INFINITY), false);
  assert.equal(hasTemperatureReading("38.1"), false);
});

test("temperature at the threshold is not elevated", () => {
  assert.equal(isElevatedTemperature(37.5, 37.5), false);
  assert.equal(isElevatedTemperature(37.6, 37.5), true);
});

test("event classification does not invent a temperature reading", () => {
  assert.equal(classifyEvent({ temperature: null, zone: "" }, 37.5), "NORMAL");
  assert.equal(classifyEvent({ temperature: null, zone: "Z02" }, 37.5), "WARNING");
  assert.equal(classifyEvent({ temperature: 38.1, zone: "" }, 37.5), "CRITICAL");
  assert.equal(classifyEvent({ temperature: 38.1, zone: "Z02" }, 37.5), "CRITICAL");
});
