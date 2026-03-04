// Sidepanel controller
const elements = {
  fileInput: document.getElementById("fileInput"),
  fileInfo: document.getElementById("fileInfo"),
  platformSelect: document.getElementById("platformSelect"),
  keywordsInput: document.getElementById("keywordsInput"),
  saveKeywordsBtn: document.getElementById("saveKeywordsBtn"),
  keywordsStatus: document.getElementById("keywordsStatus"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  progressSection: document.getElementById("progressSection"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  currentQuestion: document.getElementById("currentQuestion"),
  statusText: document.getElementById("statusText"),
  reportBtn: document.getElementById("reportBtn"),
  historyList: document.getElementById("historyList"),
  reportRoot: document.getElementById("reportRoot")
};

const DEFAULT_KEYWORDS = ["德科信息", "德科信息技术", "德科信息技术有限公司"];
const KEYWORD_CONFIG_KEY = "keywordConfig";

let currentQuestions = null;
let isPaused = false;
let reportState = {
  session: null,
  filterType: "all",
  searchQuery: ""
};

function hasLoadedQuestions() {
  return Array.isArray(currentQuestions) && currentQuestions.length > 0;
}

async function enableReportIfHasResults() {
  const session = await getCurrentSession();
  if (session && Array.isArray(session.results) && session.results.length > 0) {
    elements.reportBtn.disabled = false;
  }
}

// File upload handler
elements.fileInput.addEventListener("change", handleFileUpload);
if (elements.saveKeywordsBtn) {
  elements.saveKeywordsBtn.addEventListener("click", saveKeywordConfig);
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.endsWith(".xlsx")) {
    alert("请上传 .xlsx 文件。");
    return;
  }

  try {
    if (typeof parseExcelFile !== "function") {
      throw new Error("Excel 解析器未加载，请重新加载扩展。");
    }

    currentQuestions = await parseExcelFile(file);
    elements.fileInfo.textContent = `已选择：${file.name}（${currentQuestions.length} 条）`;
    elements.fileInfo.classList.remove("hidden");
    elements.startBtn.disabled = false;

    console.log("Parsed questions:", currentQuestions.length);
  } catch (error) {
    alert(`文件解析失败：${error.message}`);
    elements.fileInput.value = "";
    elements.startBtn.disabled = true;
  }
}

function parseKeywords(inputText) {
  if (!inputText) return [];

  const normalized = String(inputText)
    .replaceAll("，", ",")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

function getSelectedPlatforms() {
  if (!elements.platformSelect) {
    return ["deepseek"];
  }

  const selected = Array.from(elements.platformSelect.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);

  if (selected.length > 0) {
    return selected.filter((item, index, arr) => arr.indexOf(item) === index);
  }

  const fallback = elements.platformSelect.value;
  return fallback ? [fallback] : ["deepseek"];
}

function setKeywordStatus(text, isError = false) {
  if (!elements.keywordsStatus) return;
  elements.keywordsStatus.textContent = text || "";
  elements.keywordsStatus.style.color = isError ? "#c62828" : "#666";
}

function renderKeywords(keywords) {
  if (!elements.keywordsInput) return;
  const list = Array.isArray(keywords) && keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
  elements.keywordsInput.value = list.join("\n");
}

async function loadKeywordConfig() {
  try {
    const result = await chrome.storage.local.get(KEYWORD_CONFIG_KEY);
    const keywords = Array.isArray(result[KEYWORD_CONFIG_KEY]) ? result[KEYWORD_CONFIG_KEY] : [];
    renderKeywords(keywords);
    setKeywordStatus("");
  } catch (error) {
    renderKeywords(DEFAULT_KEYWORDS);
    setKeywordStatus(`读取关键词失败：${error.message}`, true);
  }
}

async function saveKeywordConfig() {
  try {
    const keywords = parseKeywords(elements.keywordsInput ? elements.keywordsInput.value : "");
    if (keywords.length === 0) {
      throw new Error("至少保留一个关键词");
    }

    await chrome.storage.local.set({ [KEYWORD_CONFIG_KEY]: keywords });
    renderKeywords(keywords);
    setKeywordStatus(`已保存 ${keywords.length} 个关键词`);
  } catch (error) {
    setKeywordStatus(`保存失败：${error.message}`, true);
  }
}

// Start test button handler
elements.startBtn.addEventListener("click", async () => {
  try {
    let questionsForRun = currentQuestions;
    if (!Array.isArray(questionsForRun) || questionsForRun.length === 0) {
      const existingSession = await getCurrentSession();
      if (existingSession && Array.isArray(existingSession.questions) && existingSession.questions.length > 0) {
        questionsForRun = existingSession.questions;
        currentQuestions = questionsForRun;
      }
    }

    if (!Array.isArray(questionsForRun) || questionsForRun.length === 0) {
      alert("请先上传询问词库。");
      return;
    }

    const selectedPlatforms = getSelectedPlatforms();
    if (selectedPlatforms.length === 0) {
      alert("请至少选择一个平台。");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: "startTest",
      data: {
        questions: questionsForRun,
        platform: selectedPlatforms[0],
        platforms: selectedPlatforms,
        keywords: parseKeywords(elements.keywordsInput ? elements.keywordsInput.value : "")
      }
    });

    if (response && response.success) {
      elements.progressSection.classList.remove("hidden");
      elements.startBtn.disabled = true;
      elements.pauseBtn.classList.remove("hidden");
      elements.pauseBtn.textContent = "暂停";
      isPaused = false;
      updateProgress(0, questionsForRun.length * selectedPlatforms.length);
    } else {
      alert(`启动测试失败：${response ? response.error : "未知错误"}`);
    }
  } catch (error) {
    alert(`启动测试失败：${error.message}`);
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

// Report button handler
elements.reportBtn.addEventListener("click", async () => {
  const session = await getCurrentSession();

  if (!session || !Array.isArray(session.results) || session.results.length === 0) {
    alert("没有可生成报告的数据。");
    return;
  }

  showReport(session);
});

function updateProgress(completed, total) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  elements.progressFill.style.width = `${percentage}%`;
  elements.progressText.textContent = `${completed} / ${total}`;
  if (completed > 0) {
    elements.reportBtn.disabled = false;
  }

  const remaining = total - completed;
  const estimatedMinutes = Math.ceil((remaining * 30) / 60);

  if (remaining > 0) {
    elements.statusText.textContent = `预计剩余：约 ${estimatedMinutes} 分钟`;
  } else {
    elements.statusText.textContent = "测试已完成";
    elements.reportBtn.disabled = false;
  }
}

function showErrorDialog(error, question, platform = "") {
  const platformPrefix = platform ? `[${platform}] ` : "";
  const userAction = confirm(
    `测试错误：\n${platformPrefix}${error}\n\n问题：${question}\n\n点击“确定”从下一条询问词继续，点击“取消”保持暂停。`
  );

  if (userAction) {
    chrome.runtime.sendMessage({ action: "resumeTest" });
  }
}

async function getCurrentSession() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSession" });
    if (response && response.session) {
      return response.session;
    }
  } catch (error) {
    // Fall back to storage snapshot below.
  }

  const result = await chrome.storage.local.get("currentSession");
  return result.currentSession || null;
}

function closeReport() {
  const reportView = document.getElementById("reportView");
  if (reportView) {
    reportView.remove();
  }
  document.querySelector(".container").classList.remove("hidden");
}

function showReport(session) {
  reportState = {
    session,
    filterType: "all",
    searchQuery: ""
  };

  document.querySelector(".container").classList.add("hidden");

  const reportView = document.createElement("div");
  reportView.id = "reportView";
  reportView.className = "report-container";
  reportView.innerHTML = generateReportHTML(session);

  const root = elements.reportRoot || document.body;
  root.appendChild(reportView);

  attachReportListeners();
  applyReportFilters();
}

function generateReportHTML(session) {
  const { results, platform, platforms, startTime, completedTime } = session;
  const platformLabel = Array.isArray(platforms) && platforms.length > 0
    ? platforms.join(", ")
    : (platform || "未知平台");
  const totalQuestions = results.length;
  const hitCount = results.filter((r) => r.isHit).length;
  const hitRate = totalQuestions > 0 ? ((hitCount / totalQuestions) * 100).toFixed(2) : "0.00";
  const duration = startTime && completedTime
    ? Math.max(0, Math.floor((completedTime - startTime) / 60000))
    : 0;

  return `
    <div class="report-header">
      <div>
        <h1>测试报告</h1>
        <p>${escapeHtml(platformLabel)} - ${formatDateTime(startTime)}</p>
      </div>
      <button id="reportBackBtn" class="btn btn-secondary">返回</button>
    </div>

    <div class="report-summary">
      <h2>总体指标</h2>
      <div class="metric-card">
        <div class="metric-title">关键词命中率</div>
        <div class="metric-value">${hitRate}%</div>
        <div class="metric-subtitle">${hitCount} / ${totalQuestions}</div>
      </div>
      <div class="metric-row">
        <div class="metric-item">
          <span class="metric-label">总问题数</span>
          <span class="metric-data">${totalQuestions}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">命中数</span>
          <span class="metric-data success">${hitCount}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">未命中数</span>
          <span class="metric-data">${totalQuestions - hitCount}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">测试时长</span>
          <span class="metric-data">${duration} 分钟</span>
        </div>
      </div>
    </div>

    <div class="report-filters">
      <h2>筛选与搜索</h2>
      <div class="filter-row">
        <select id="filterType" class="filter-select">
          <option value="all">全部</option>
          <option value="hit">仅命中</option>
          <option value="miss">仅未命中</option>
        </select>
        <input type="text" id="searchInput" class="search-input" placeholder="搜索问题...">
      </div>
    </div>

    <div class="report-details">
      <h2>详细结果</h2>
      <div id="resultsList" class="results-list"></div>
    </div>

    <div class="report-actions">
      <button id="exportBtn" class="btn btn-primary">导出 CSV</button>
      <button id="closeReportBtn" class="btn btn-secondary">关闭</button>
    </div>
  `;
}

function attachReportListeners() {
  const filterType = document.getElementById("filterType");
  const searchInput = document.getElementById("searchInput");
  const backBtn = document.getElementById("reportBackBtn");
  const closeBtn = document.getElementById("closeReportBtn");
  const exportBtn = document.getElementById("exportBtn");
  const resultsList = document.getElementById("resultsList");

  if (filterType) {
    filterType.addEventListener("change", (event) => {
      reportState.filterType = event.target.value;
      applyReportFilters();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      reportState.searchQuery = event.target.value || "";
      applyReportFilters();
    });
  }

  if (backBtn) backBtn.addEventListener("click", closeReport);
  if (closeBtn) closeBtn.addEventListener("click", closeReport);
  if (exportBtn) exportBtn.addEventListener("click", exportToExcel);

  if (resultsList) {
    resultsList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.getAttribute("data-action");
      const index = Number.parseInt(button.getAttribute("data-index") || "-1", 10);
      if (Number.isNaN(index) || index < 0) return;

      switch (action) {
        case "screenshot":
          await viewScreenshot(index);
          break;
        case "answer":
          await viewAnswer(index);
          break;
        default:
          break;
      }
    });
  }
}

function applyReportFilters() {
  if (!reportState.session) return;

  const filterType = reportState.filterType;
  const searchQuery = reportState.searchQuery.trim().toLowerCase();
  const source = reportState.session.results || [];

  const filtered = source
    .map((result, index) => ({ ...result, _index: index }))
    .filter((result) => {
      if (filterType === "hit" && !result.isHit) return false;
      if (filterType === "miss" && result.isHit) return false;

      if (searchQuery) {
        const question = String(result.question || "").toLowerCase();
        const platform = String(result.platform || "").toLowerCase();
        if (!question.includes(searchQuery) && !platform.includes(searchQuery)) return false;
      }
      return true;
    });

  const list = document.getElementById("resultsList");
  if (list) {
    list.innerHTML = generateResultsListHTML(filtered);
  }
}

function generateResultsListHTML(results) {
  if (results.length === 0) {
    return '<p class="empty-state">暂无匹配结果。</p>';
  }

  return results.map((result) => {
    const matched = Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [];
    const statusText = result.isHit ? "命中" : "未命中";
    const statusClass = result.isHit ? "hit" : "miss";

    return `
      <div class="result-item ${statusClass}" data-index="${result._index}">
        <div class="result-header">
          <span class="result-number">#${result._index + 1}</span>
          <span class="result-status">${statusText}</span>
        </div>
        <div class="result-question">
          <strong>问题：</strong> ${escapeHtml(result.question || "")}
        </div>
        <div class="result-platform">
          <strong>平台：</strong> ${escapeHtml(result.platform || "未知平台")}
        </div>
        ${result.isHit ? `
          <div class="result-keywords">
            <strong>匹配关键词：</strong> ${escapeHtml(matched.join(", "))}
          </div>
        ` : ""}
        <div class="result-actions">
          <button class="btn-small" data-action="screenshot" data-index="${result._index}">查看截图</button>
          <button class="btn-small" data-action="answer" data-index="${result._index}">查看回答</button>
        </div>
      </div>
    `;
  }).join("");
}

function closeModal() {
  const modal = document.querySelector(".modal");
  if (modal) {
    modal.remove();
  }
}

function openModal(title, bodyHTML, footerHTML) {
  closeModal();

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" id="modalCloseBtn" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-footer">${footerHTML}</div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector("#modalCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }
}

async function viewScreenshot(index) {
  if (!reportState.session) return;
  const result = reportState.session.results[index];
  if (!result || !result.screenshot) {
    alert("该结果没有截图。");
    return;
  }

  const bodyHTML = `
    <p><strong>问题：</strong> ${escapeHtml(result.question || "")}</p>
    <img src="${result.screenshot}" alt="Screenshot" class="screenshot-img">
  `;

  const footerHTML = `
    <button class="btn btn-primary" id="downloadShotBtn">下载</button>
    <button class="btn btn-secondary" id="closeShotBtn">关闭</button>
  `;

  openModal("对话截图", bodyHTML, footerHTML);

  const downloadBtn = document.getElementById("downloadShotBtn");
  const closeBtn = document.getElementById("closeShotBtn");

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => downloadScreenshot(index));
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }
}

async function viewAnswer(index) {
  if (!reportState.session) return;
  const result = reportState.session.results[index];
  if (!result) return;

  const matched = Array.isArray(result.matchedKeywords) ? result.matchedKeywords : [];
  const bodyHTML = `
    <p><strong>问题：</strong> ${escapeHtml(result.question || "")}</p>
    <div class="answer-text">${escapeHtml(result.answer || "暂无回答内容。")}</div>
    ${result.isHit ? `
      <div class="keywords-match">
        <strong>命中关键词：</strong> ${escapeHtml(matched.join(", "))}
      </div>
    ` : ""}
  `;

  const footerHTML = `
    <button class="btn btn-primary" id="copyAnswerBtn">复制文本</button>
    <button class="btn btn-secondary" id="closeAnswerBtn">关闭</button>
  `;

  openModal("完整回答", bodyHTML, footerHTML);

  const copyBtn = document.getElementById("copyAnswerBtn");
  const closeBtn = document.getElementById("closeAnswerBtn");
  if (copyBtn) copyBtn.addEventListener("click", () => copyAnswer(index));
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
}

function downloadScreenshot(index) {
  if (!reportState.session) return;
  const result = reportState.session.results[index];
  if (!result || !result.screenshot) return;

  const link = document.createElement("a");
  link.href = result.screenshot;
  link.download = `screenshot_${index + 1}.png`;
  link.click();
}

async function copyAnswer(index) {
  if (!reportState.session) return;
  const result = reportState.session.results[index];
  const text = result ? (result.answer || "") : "";

  try {
    await navigator.clipboard.writeText(text);
    alert("回答已复制到剪贴板。");
  } catch (error) {
    alert(`复制失败：${error.message}`);
  }
}

function exportToExcel() {
  if (!reportState.session) return;
  const { results, platform, platforms, startTime } = reportState.session;
  const platformLabel = Array.isArray(platforms) && platforms.length > 0
    ? platforms.join("+")
    : (platform || "平台");

  const csvContent = generateCSV(results || []);
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  const datePart = startTime ? new Date(startTime).toISOString().split("T")[0] : "unknown-date";
  link.href = url;
  link.download = `GEO测试报告_${platformLabel}_${datePart}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function generateCSV(results) {
  const headers = ["序号", "平台", "问题", "类别", "是否命中", "匹配关键词", "完整回答内容", "时间戳"];
  const rows = results.map((result, index) => [
    index + 1,
    csvCell(result.platform || ""),
    csvCell(result.question || ""),
    csvCell(result.category || ""),
    result.isHit ? "是" : "否",
    csvCell(Array.isArray(result.matchedKeywords) ? result.matchedKeywords.join(", ") : ""),
    csvCell(result.answer || ""),
    result.timestamp ? new Date(result.timestamp).toLocaleString() : ""
  ]);

  return [
    headers.join(","),
    ...rows.map((row) => row.join(","))
  ].join("\n");
}

function csvCell(value) {
  const text = String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function formatDateTime(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function viewHistoryReport(sessionId) {
  const current = await getCurrentSession();
  if (current && current.id === sessionId && Array.isArray(current.results) && current.results.length > 0) {
    showReport(current);
    return;
  }

  alert("当前实现仅支持查看最近一次完成会话的详细报告。");
}

async function loadHistory() {
  const result = await chrome.storage.local.get("history");
  const history = result.history || [];

  if (history.length === 0) {
    elements.historyList.innerHTML = '<p class="empty-state">暂无历史记录。</p>';
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
          <div class="history-date">${formatDateTime(item.completedTime)}</div>
          <div class="history-platform">${escapeHtml(item.platform || "未知平台")}</div>
          <div class="history-rate">命中率：${hitRatePercent}% (${item.hitCount}/${item.totalQuestions})</div>
          <button class="btn-small" data-session-id="${escapeHtml(item.sessionId || "")}">查看报告</button>
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

// Listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case "questionStarted":
      elements.currentQuestion.textContent = `当前问题 [${message.platform || "平台"}]：“${message.question}”`;
      elements.statusText.textContent = "等待回答...";
      break;
    case "progressUpdate":
      updateProgress(message.progress.completed, message.progress.total);
      break;
    case "testCompleted":
      elements.currentQuestion.textContent = "";
      elements.statusText.textContent = "测试已完成";
      elements.pauseBtn.classList.add("hidden");
      elements.reportBtn.disabled = false;
      elements.startBtn.disabled = false;
      loadHistory();
      break;
    case "testPaused":
      isPaused = true;
      elements.pauseBtn.classList.remove("hidden");
      elements.pauseBtn.textContent = "恢复";
      elements.statusText.textContent = "测试已暂停";
      elements.startBtn.disabled = false;
      enableReportIfHasResults();
      break;
    case "testResumed":
      isPaused = false;
      elements.pauseBtn.textContent = "暂停";
      elements.statusText.textContent = "测试进行中...";
      break;
    case "error":
      isPaused = true;
      elements.pauseBtn.classList.remove("hidden");
      elements.pauseBtn.textContent = "恢复";
      elements.statusText.textContent = `错误 [${message.platform || "平台"}]：${message.error}`;
      elements.startBtn.disabled = false;
      enableReportIfHasResults();
      showErrorDialog(message.error, message.question, message.platform);
      break;
    default:
      break;
  }
});

// Expose modal/report close for fallback inline handlers if any.
window.closeReport = closeReport;
window.closeModal = closeModal;

// Initialize history on startup
loadHistory();
loadKeywordConfig();
enableReportIfHasResults();
console.log("Sidepanel initialized");
