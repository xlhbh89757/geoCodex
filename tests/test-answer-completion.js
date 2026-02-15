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
    answerText: "previous answer"
  });
  assert(state.isComplete === false, "should not complete at start");

  state = tracker.update({
    now: 12000,
    hasStopButton: false,
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
    answerText: "previous answer"
  });

  tracker.update({
    now: 3000,
    hasStopButton: true,
    answerText: "previous answer new part"
  });

  const state = tracker.update({
    now: 9000,
    hasStopButton: false,
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
    answerText: "hello"
  });

  const state = tracker.update({
    now: 5000,
    hasStopButton: true,
    answerText: "hello"
  });

  assert(state.isComplete === false, "should not complete while stop button is visible");
}

function run() {
  testNoCompletionWithoutNewAnswer();
  testCompletionAfterNewStableAnswer();
  testNoCompletionWhileStopVisible();
  console.log("All answer completion tests passed");
}

run();
