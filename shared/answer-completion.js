// Stateful completion tracker for streamed chat answers.

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function createAnswerCompletionTracker(options = {}) {
  const baseline = normalizeText(options.baselineText || "");
  const baselineControlSignature = String(options.baselineControlSignature || "");
  const minObserveMs = Number(options.minObserveMs || 8000);
  const minStableMs = Number(options.minStableMs || 4000);
  const minNoStopAfterSeenMs = Number(options.minNoStopAfterSeenMs || 1200);
  const minStableAfterStopMs = Number(options.minStableAfterStopMs || 600);
  const minControlReturnMs = Number(options.minControlReturnMs || 700);
  const hardFallbackMs = Number(options.hardFallbackMs || 60000);

  let startedAt = null;
  let lastNormalized = null;
  let lastChangedAt = null;
  let observedNewAnswer = false;
  let sawStopButton = false;
  let noStopSince = null;
  let sawControlChange = false;
  let controlBackSince = null;

  function update(input) {
    const now = input.now == null ? Date.now() : Number(input.now);
    const hasStopButton = Boolean(input.hasStopButton);
    const hasSendButton = Boolean(input.hasSendButton);
    const controlSignature = String(input.controlSignature || "");
    const normalized = normalizeText(input.answerText);

    if (startedAt === null) {
      startedAt = now;
      lastChangedAt = now;
      lastNormalized = normalized;
      if (normalized && normalized !== baseline) {
        observedNewAnswer = true;
      }
    } else if (normalized !== lastNormalized) {
      lastNormalized = normalized;
      lastChangedAt = now;
      if (normalized && normalized !== baseline) {
        observedNewAnswer = true;
      }
    }

    if (hasStopButton) {
      sawStopButton = true;
      noStopSince = null;
    } else if (sawStopButton) {
      if (noStopSince === null) {
        noStopSince = now;
      }
    } else {
      noStopSince = null;
    }

    if (baselineControlSignature && controlSignature) {
      if (controlSignature !== baselineControlSignature) {
        sawControlChange = true;
        controlBackSince = null;
      } else if (sawControlChange) {
        if (controlBackSince === null) {
          controlBackSince = now;
        }
      }
    }

    const elapsed = now - startedAt;
    const stableMs = now - lastChangedAt;
    const stableAndObserved = observedNewAnswer &&
      elapsed >= minObserveMs &&
      stableMs >= minStableMs;
    const stopClearedAfterSeen = sawStopButton &&
      noStopSince !== null &&
      now - noStopSince >= minNoStopAfterSeenMs &&
      stableMs >= minStableAfterStopMs;
    const controlReturnedAfterChange = sawControlChange &&
      controlBackSince !== null &&
      now - controlBackSince >= minControlReturnMs;
    const hitHardFallback = elapsed >= hardFallbackMs && stableMs >= minStableMs;

    return {
      isComplete: !hasStopButton && (
        controlReturnedAfterChange ||
        stopClearedAfterSeen ||
        stableAndObserved ||
        hitHardFallback
      ),
      elapsed,
      stableMs,
      observedNewAnswer,
      sawStopButton,
      hasSendButton
    };
  }

  return { update };
}

if (typeof window !== "undefined") {
  window.createAnswerCompletionTracker = createAnswerCompletionTracker;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createAnswerCompletionTracker
  };
}
