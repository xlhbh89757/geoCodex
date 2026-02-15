// Regression tests for answer completion detection.

const { createAnswerCompletionTracker } = require("../shared/answer-completion.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testNoCompletionWithoutNewAnswer() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    minObserveMs: 8000,
    minStableMs: 4000
  });

  let state = tracker.update({
    now: 0,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer"
  });
  assert(state.isComplete === false, "should not complete at start");

  state = tracker.update({
    now: 12000,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer"
  });
  assert(state.isComplete === false, "should not complete without new answer");
}

function testCompletionAfterNewStableAnswer() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    minObserveMs: 8000,
    minStableMs: 4000
  });

  tracker.update({
    now: 0,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "previous answer"
  });

  tracker.update({
    now: 3000,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "previous answer new part"
  });

  const state = tracker.update({
    now: 9000,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer new part"
  });

  assert(state.isComplete === true, "should complete after stable new answer");
}

function testNoCompletionWhileStopVisible() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "",
    minObserveMs: 2000,
    minStableMs: 1000
  });

  tracker.update({
    now: 0,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "hello"
  });

  const state = tracker.update({
    now: 5000,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "hello"
  });

  assert(state.isComplete === false, "should not complete while stop button is visible");
}

function testCompletionWhenStopTurnsBackToSend() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    minObserveMs: 8000,
    minStableMs: 4000,
    minNoStopAfterSeenMs: 1200
  });

  tracker.update({
    now: 0,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "previous answer new part"
  });

  tracker.update({
    now: 1000,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer new part"
  });

  const state = tracker.update({
    now: 2300,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer new part"
  });

  assert(
    state.isComplete === true,
    "should complete quickly after stop button turns back to send"
  );
}

function testNoCompletionWhenSendVisibleWithoutStopHistory() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    minObserveMs: 8000,
    minStableMs: 4000,
    minNoStopAfterSeenMs: 1200
  });

  const state = tracker.update({
    now: 2300,
    hasStopButton: false,
    hasSendButton: true,
    answerText: "previous answer"
  });

  assert(
    state.isComplete === false,
    "should not complete only because send button is visible"
  );
}

function testCompletionWhenStopGoneEvenIfSendDisabled() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    minObserveMs: 8000,
    minStableMs: 4000,
    minNoStopAfterSeenMs: 1200,
    minStableAfterStopMs: 600
  });

  tracker.update({
    now: 0,
    hasStopButton: true,
    hasSendButton: false,
    answerText: "previous answer new part"
  });

  tracker.update({
    now: 1000,
    hasStopButton: false,
    hasSendButton: false,
    answerText: "previous answer new part"
  });

  const state = tracker.update({
    now: 2300,
    hasStopButton: false,
    hasSendButton: false,
    answerText: "previous answer new part"
  });

  assert(
    state.isComplete === true,
    "should complete after stop is gone even if send button is disabled"
  );
}

function testCompletionWhenPrimaryControlReturnsToBaseline() {
  const tracker = createAnswerCompletionTracker({
    baselineText: "previous answer",
    baselineControlSignature: "send-state",
    minControlReturnMs: 700
  });

  tracker.update({
    now: 0,
    hasStopButton: false,
    hasSendButton: true,
    controlSignature: "stop-state",
    answerText: "previous answer"
  });

  tracker.update({
    now: 500,
    hasStopButton: false,
    hasSendButton: true,
    controlSignature: "send-state",
    answerText: "previous answer"
  });

  const state = tracker.update({
    now: 1300,
    hasStopButton: false,
    hasSendButton: true,
    controlSignature: "send-state",
    answerText: "previous answer"
  });

  assert(
    state.isComplete === true,
    "should complete when primary control changes and returns to baseline"
  );
}

function run() {
  testNoCompletionWithoutNewAnswer();
  testCompletionAfterNewStableAnswer();
  testNoCompletionWhileStopVisible();
  testCompletionWhenStopTurnsBackToSend();
  testNoCompletionWhenSendVisibleWithoutStopHistory();
  testCompletionWhenStopGoneEvenIfSendDisabled();
  testCompletionWhenPrimaryControlReturnsToBaseline();
  console.log("All answer completion tests passed");
}

run();
