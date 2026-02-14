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

// File upload handler
elements.fileInput.addEventListener("change", handleFileUpload);

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.endsWith(".xlsx")) {
    alert("请上传 .xlsx 格式的文件");
    return;
  }

  elements.fileInfo.textContent = `已选择: ${file.name}`;
  elements.fileInfo.classList.remove("hidden");
  elements.startBtn.disabled = false;
}

console.log("Sidepanel initialized");
