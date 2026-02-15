// Stateful completion tracker for streamed chat answers.

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function createAnswerCompletionTracker(options = {}) {
  const baseline = normalizeText(options.baselineText || "");
  const minObserveMs = Number(options.minObserveMs || 8000);
  const minStableMs = Number(options.minStableMs || 4000);
  const minReadyAfterStopMs = Number(options.minReadyAfterStopMs || 1200);
  const hardFallbackMs = Number(options.hardFallbackMs || 60000);

  let startedAt = null;
  let lastNormalized = null;
  let lastChangedAt = null;
  let observedNewAnswer = false;
  let sawStopButton = false;
  let sendReadySince = null;

  function update(input) {
    const now = input.now == null ? Date.now() : Number(input.now);
    const hasStopButton = Boolean(input.hasStopButton);
    const hasSendButton = Boolean(input.hasSendButton);
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
      sendReadySince = null;
    } else if (hasSendButton) {
      if (sendReadySince === null) {
        sendReadySince = now;
      }
    } else {
      sendReadySince = null;
    }

    const elapsed = now - startedAt;
    const stableMs = now - lastChangedAt;
    const stableAndObserved = observedNewAnswer &&
      elapsed >= minObserveMs &&
      stableMs >= minStableMs;
    const sendReturnedAfterStop = sawStopButton &&
      sendReadySince !== null &&
      now - sendReadySince >= minReadyAfterStopMs;
    const hitHardFallback = elapsed >= hardFallbackMs && stableMs >= minStableMs;

    return {
      isComplete: !hasStopButton && (
        sendReturnedAfterStop ||
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
