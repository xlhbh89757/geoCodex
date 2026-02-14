// Sidepanel controller
const elements = {
  fileInput: document.getElementById("fileInput"),
  fileInfo: document.getElementById("fileInfo"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  progressSection: document.getElementById("progressSection"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  currentQuestion: document.getElementById("currentQuestion"),
  statusText: document.getElementById("statusText"),
  reportBtn: document.getElementById("reportBtn"),
  historyList: document.getElementById("historyList")
};

let currentQuestions = null;
let isPaused = false;

// File upload handler
elements.fileInput.addEventListener("change", handleFileUpload);

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.endsWith(".xlsx")) {
    alert("请上传 .xlsx 格式的文件");
    return;
  }

  try {
    if (typeof parseExcelFile !== "function") {
      throw new Error("Excel 解析器未加载，请重新加载扩展");
    }

    currentQuestions = await parseExcelFile(file);
    elements.fileInfo.textContent = `已选择: ${file.name} (${currentQuestions.length} 条询问词)`;
    elements.fileInfo.classList.remove("hidden");
    elements.startBtn.disabled = false;

    console.log("Parsed questions:", currentQuestions.length);
  } catch (error) {
    alert(`文件解析失败: ${error.message}`);
    elements.fileInput.value = "";
    elements.startBtn.disabled = true;
  }
}

// Start test button handler
elements.startBtn.addEventListener("click", async () => {
  if (!currentQuestions || currentQuestions.length === 0) {
    alert("请先上传询问词库");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "startTest",
      data: {
        questions: currentQuestions,
        platform: "deepseek"
      }
    });

    if (response && response.success) {
      elements.progressSection.classList.remove("hidden");
      elements.startBtn.disabled = true;
      elements.pauseBtn.classList.remove("hidden");
      elements.pauseBtn.textContent = "暂停";
      isPaused = false;
      updateProgress(0, currentQuestions.length);
    } else {
      alert(`启动测试失败: ${response ? response.error : "Unknown error"}`);
    }
  } catch (error) {
    alert(`启动测试失败: ${error.message}`);
  }
});

// Pause/resume button handler
elements.pauseBtn.addEventListener("click", async () => {
  if (!isPaused) {
    const response = await chrome.runtime.sendMessage({ action: "pauseTest" });
    if (response && response.success) {
      isPaused = true;
      elements.pauseBtn.textContent = "恢复";
    }
    return;
  }

  const response = await chrome.runtime.sendMessage({ action: "resumeTest" });
  if (response && response.success) {
    isPaused = false;
    elements.pauseBtn.textContent = "暂停";
  }
});

// Update progress display
function updateProgress(completed, total) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  elements.progressFill.style.width = `${percentage}%`;
  elements.progressText.textContent = `${completed} / ${total}`;

  const remaining = total - completed;
  const estimatedMinutes = Math.ceil((remaining * 30) / 60);

  if (remaining > 0) {
    elements.statusText.textContent = `预计剩余时间: 约 ${estimatedMinutes} 分钟`;
  } else {
    elements.statusText.textContent = "测试完成";
    elements.reportBtn.disabled = false;
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case "questionStarted":
      elements.currentQuestion.textContent = `当前问题: "${message.question}"`;
      elements.statusText.textContent = "等待回答完成...";
      break;

    case "progressUpdate":
      updateProgress(message.progress.completed, message.progress.total);
      break;

    case "testCompleted":
      elements.currentQuestion.textContent = "";
      elements.statusText.textContent = "测试已完成";
      elements.pauseBtn.classList.add("hidden");
      elements.reportBtn.disabled = false;
      loadHistory();
      break;

    case "testPaused":
      isPaused = true;
      elements.pauseBtn.textContent = "恢复";
      elements.statusText.textContent = "测试已暂停";
      break;

    case "testResumed":
      isPaused = false;
      elements.pauseBtn.textContent = "暂停";
      elements.statusText.textContent = "继续测试中...";
      break;

    case "error":
      elements.statusText.textContent = `错误: ${message.error}`;
      showErrorDialog(message.error, message.question);
      break;

    default:
      break;
  }
});

function showErrorDialog(error, question) {
  const userAction = confirm(
    `测试遇到错误:\n${error}\n\n问题: ${question}\n\n点击“确定”继续（恢复），点击“取消”保持暂停`
  );

  if (userAction) {
    chrome.runtime.sendMessage({ action: "resumeTest" });
  }
}

// Load and display history
async function loadHistory() {
  const result = await chrome.storage.local.get("history");
  const history = result.history || [];

  if (history.length === 0) {
    elements.historyList.innerHTML = '<p class="empty-state">暂无历史记录</p>';
    return;
  }

  elements.historyList.innerHTML = history
    .map((item) => {
      const hitRateValue = Number.parseFloat(item.hitRate || 0);
      const hitRatePercent = Number.isFinite(hitRateValue)
        ? (hitRateValue * 100).toFixed(2)
        : "0.00";

      return `
        <div class="history-item">
          <div class="history-date">${new Date(item.completedTime).toLocaleString()}</div>
          <div class="history-platform">${item.platform}</div>
          <div class="history-rate">命中率: ${hitRatePercent}% (${item.hitCount}/${item.totalQuestions})</div>
          <button class="btn-small" data-session-id="${item.sessionId}">查看报告</button>
        </div>
      `;
    })
    .join("");

  elements.historyList.querySelectorAll(".btn-small").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.getAttribute("data-session-id");
      viewHistoryReport(sessionId);
    });
  });
}

function viewHistoryReport(sessionId) {
  alert(`报告查看功能将在 Task 8 实现。\nSession: ${sessionId}`);
}

// Initialize history on startup
loadHistory();

console.log("Sidepanel initialized");
