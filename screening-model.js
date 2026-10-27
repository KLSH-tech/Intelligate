"use strict";

(function exposeScreeningModel(root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = model;
  } else {
    root.IntelliGateScreeningModel = model;
  }
}(globalThis, () => {
  function hasTemperatureReading(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isElevatedTemperature(value, threshold) {
    return hasTemperatureReading(value) &&
      Number.isFinite(threshold) &&
      value > threshold;
  }

  function classifyEvent({ temperature, zone }, threshold) {
    if (isElevatedTemperature(temperature, threshold)) return "CRITICAL";
    return zone ? "WARNING" : "NORMAL";
  }

  return { hasTemperatureReading, isElevatedTemperature, classifyEvent };
}));
