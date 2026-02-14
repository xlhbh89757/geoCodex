// Local XLSX parser for Chrome extension pages.
// Avoids external CDN scripts because extension CSP only allows script-src 'self'.

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target.result;
        const questions = await parseXlsxBuffer(arrayBuffer);
        resolve(questions);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

async function parseXlsxBuffer(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("无效的 Excel 数据");
  }

  const zip = await readZipEntries(arrayBuffer);
  const workbookXml = getTextEntry(zip, "xl/workbook.xml");
  const relsXml = getTextEntry(zip, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = getOptionalTextEntry(zip, "xl/sharedStrings.xml");

  const sheetPath = resolveFirstSheetPath(workbookXml, relsXml);
  const sheetXml = getTextEntry(zip, sheetPath);
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const rows = parseSheetRows(sheetXml, sharedStrings);

  if (rows.length === 0) {
    throw new Error("Excel 文件为空");
  }

  const headerRow = rows[0];
  const requiredKeys = ["词根类型", "询问词"];

  // Normalize headers so "词根 类型" / "询问 词" still work.
  const normalizedHeaderMap = {};
  for (const [col, value] of Object.entries(headerRow)) {
    normalizedHeaderMap[normalizeText(value)] = col;
  }

  const categoryCol = normalizedHeaderMap[normalizeText(requiredKeys[0])];
  const questionCol = normalizedHeaderMap[normalizeText(requiredKeys[1])];

  if (!categoryCol || !questionCol) {
    throw new Error('Excel 缺少必需列: "词根类型" 和 "询问词"');
  }

  const questions = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const category = toCleanString(row[categoryCol]);
    const question = toCleanString(row[questionCol]);

    if (!question) {
      continue;
    }

    questions.push({
      id: questions.length,
      category,
      question
    });
  }

  if (questions.length === 0) {
    throw new Error("未解析到有效询问词");
  }

  return questions;
}

function normalizeText(value) {
  return toCleanString(value).replace(/\s+/g, "");
}

function toCleanString(value) {
  return value == null ? "" : String(value).trim();
}

function getTextEntry(zip, path) {
  const entry = zip[path];
  if (!entry) {
    throw new Error(`Excel 结构异常，缺少文件: ${path}`);
  }
  return utf8Decode(entry);
}

function getOptionalTextEntry(zip, path) {
  const entry = zip[path];
  return entry ? utf8Decode(entry) : "";
}

function resolveFirstSheetPath(workbookXml, relsXml) {
  const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");

  const firstSheet = workbookDoc.getElementsByTagName("sheet")[0];
  if (!firstSheet) {
    return "xl/worksheets/sheet1.xml";
  }

  const relId = firstSheet.getAttribute("r:id") || firstSheet.getAttribute("id");
  if (!relId) {
    return "xl/worksheets/sheet1.xml";
  }

  const relationships = relsDoc.getElementsByTagName("Relationship");
  for (const rel of relationships) {
    if (rel.getAttribute("Id") === relId) {
      const target = rel.getAttribute("Target") || "";
      if (!target) break;

      if (target.startsWith("/")) {
        return target.replace(/^\//, "");
      }
      if (target.startsWith("xl/")) {
        return target;
      }
      return `xl/${target}`.replace(/\/{2,}/g, "/");
    }
  }

  return "xl/worksheets/sheet1.xml";
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const sis = doc.getElementsByTagName("si");
  const result = [];

  for (const si of sis) {
    const tNodes = si.getElementsByTagName("t");
    if (tNodes.length === 0) {
      result.push("");
      continue;
    }
    let text = "";
    for (const tNode of tNodes) {
      text += tNode.textContent || "";
    }
    result.push(text);
  }

  return result;
}

function parseSheetRows(sheetXml, sharedStrings) {
  const doc = new DOMParser().parseFromString(sheetXml, "application/xml");
  const rowNodes = doc.getElementsByTagName("row");
  const rows = [];

  for (const rowNode of rowNodes) {
    const cellNodes = rowNode.getElementsByTagName("c");
    const rowObject = {};

    for (const cellNode of cellNodes) {
      const ref = cellNode.getAttribute("r") || "";
      const col = extractColumnRef(ref);
      if (!col) continue;
      rowObject[col] = parseCellValue(cellNode, sharedStrings);
    }

    rows.push(rowObject);
  }

  return rows;
}

function parseCellValue(cellNode, sharedStrings) {
  const type = cellNode.getAttribute("t") || "";

  if (type === "inlineStr") {
    const tNode = cellNode.getElementsByTagName("t")[0];
    return tNode ? tNode.textContent || "" : "";
  }

  const vNode = cellNode.getElementsByTagName("v")[0];
  const raw = vNode ? vNode.textContent || "" : "";

  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    if (Number.isNaN(index) || index < 0 || index >= sharedStrings.length) {
      return "";
    }
    return sharedStrings[index];
  }

  if (type === "b") {
    return raw === "1" ? "TRUE" : "FALSE";
  }

  return raw;
}

function extractColumnRef(cellRef) {
  const match = /^([A-Z]+)/i.exec(cellRef);
  return match ? match[1].toUpperCase() : "";
}

async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdOffset = findEocdOffset(bytes);

  if (eocdOffset < 0) {
    throw new Error("文件不是有效的 XLSX (ZIP) 格式");
  }

  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = centralDirectoryOffset;

  const entries = {};

  for (let i = 0; i < totalEntries; i += 1) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error("ZIP 中央目录损坏");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameStart = offset + 46;
    const nameBytes = bytes.slice(nameStart, nameStart + fileNameLength);
    const name = utf8Decode(nameBytes);

    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) {
      throw new Error(`ZIP 本地文件头损坏: ${name}`);
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    entries[name] = await inflateEntry(compressionMethod, compressedData);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEocdOffset(bytes) {
  // EOCD can appear within the last 64KB + 22 bytes.
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

async function inflateEntry(compressionMethod, compressedData) {
  if (compressionMethod === 0) {
    return compressedData;
  }

  if (compressionMethod !== 8) {
    throw new Error(`不支持的 ZIP 压缩方法: ${compressionMethod}`);
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持 DecompressionStream，无法解析 XLSX");
  }

  const stream = new Blob([compressedData]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  );
  const outBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(outBuffer);
}

function utf8Decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

if (typeof window !== "undefined") {
  window.parseExcelFile = parseExcelFile;
}
