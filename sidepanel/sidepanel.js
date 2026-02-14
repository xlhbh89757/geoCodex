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

    // Parse questions from Excel
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

console.log("Sidepanel initialized");
