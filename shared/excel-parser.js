// Excel parser using SheetJS
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        // Parse first worksheet
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        if (jsonData.length === 0) {
          throw new Error("Excel 文件为空");
        }

        const firstRow = jsonData[0];
        if (!firstRow["词根类型"] || !firstRow["询问词"]) {
          throw new Error('Excel 缺少必需列: "词根类型" 和 "询问词"');
        }

        const questions = jsonData.map((row, index) => ({
          id: index,
          category: row["词根类型"],
          question: row["询问词"]
        }));

        resolve(questions);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

if (typeof window !== "undefined") {
  window.parseExcelFile = parseExcelFile;
}
