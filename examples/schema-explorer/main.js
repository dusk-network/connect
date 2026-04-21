import { defineDuskConnectButton } from "../../dist/ui.js";
import { createDuskApp, DUSK_CHAIN_PRESETS } from "../../dist/index.js";

defineDuskConnectButton();

const $ = (id) => document.getElementById(id);

const inputNetwork = $("input-network");
const inputNode = $("input-node");
const inputContract = $("input-contract");
const inputDriver = $("input-driver");
const btnApply = $("btn-apply");
const elStatus = $("status");
const connectBtn = $("connectBtn");

const elContractInfo = $("contractInfo");
const elDynamicMethods = $("dynamicMethods");
const elRawSchema = $("rawSchema");
const elSchemaLog = $("schemaLog");

const DEFAULTS = {
  network: "testnet",
  nodeUrl: "https://testnet.nodes.dusk.network",
  driverUrl: "../drc20-demo/data_driver.wasm?v=" + Date.now(),
  contractId: "0x" + "".padStart(64, "0"),
};

function getParam(name, fallback) {
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === "" ? fallback : v;
}

function normalizeNetwork(net) {
  const n = String(net || "").toLowerCase();
  if (n === "mainnet" || n === "devnet" || n === "testnet") return n;
  return DEFAULTS.network;
}

function chainIdForNetwork(net) {
  switch (net) {
    case "mainnet":
      return DUSK_CHAIN_PRESETS.mainnet;
    case "devnet":
      return DUSK_CHAIN_PRESETS.devnet;
    case "testnet":
    default:
      return DUSK_CHAIN_PRESETS.testnet;
  }
}

function setStatus(msg, tone = "muted") {
  if (!elStatus) return;
  elStatus.textContent = msg || "—";
  elStatus.className = `hint ${tone}`;
}

function schemaLog(msg) {
  if (!elSchemaLog) return;
  const now = new Date().toLocaleTimeString();
  elSchemaLog.textContent = `[${now}] ${msg}\n` + elSchemaLog.textContent;
}

function appendInfoRow(container, label, value) {
  const row = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label}:`;
  row.appendChild(strong);
  row.appendChild(document.createTextNode(` ${value}`));
  container.appendChild(row);
}

function inferInputType(typeInfo) {
  const typeStr = typeof typeInfo === "string" ? typeInfo : JSON.stringify(typeInfo);
  const lower = typeStr.toLowerCase();

  if (
    lower.includes("u8") ||
    lower.includes("u16") ||
    lower.includes("u32") ||
    lower.includes("u64") ||
    lower.includes("u128") ||
    lower.includes("i8") ||
    lower.includes("i16") ||
    lower.includes("i32") ||
    lower.includes("i64") ||
    lower.includes("i128") ||
    lower.includes("usize") ||
    lower.includes("isize")
  ) {
    return {
      htmlType: "number",
      placeholder: "e.g. 42",
      parse: (val) => {
        if (val === "") return null;
        const n = BigInt(val);
        return n <= Number.MAX_SAFE_INTEGER && n >= Number.MIN_SAFE_INTEGER ? Number(n) : n;
      },
    };
  }

  if (lower.includes("bool")) {
    return {
      htmlType: "checkbox",
      placeholder: "",
      parse: (val) => val === "true" || val === true,
    };
  }

  if (lower.includes("string") || lower.includes("str")) {
    return {
      htmlType: "text",
      placeholder: "e.g. hello",
      parse: (val) => val,
    };
  }

  if (lower.includes("address") || lower.includes("hex") || lower.includes("0x")) {
    return {
      htmlType: "text",
      placeholder: "0x...",
      parse: (val) => val,
    };
  }

  return {
    htmlType: "text",
    placeholder: "JSON value",
    parse: (val) => {
      if (val === "") return null;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    },
  };
}

function createMethodCard(methodName, methodInfo, contract, wallet) {
  const card = document.createElement("div");
  card.className = "methodCard";

  const nameLower = methodName.toLowerCase();
  const isRead =
    nameLower.startsWith("get_") ||
    nameLower.startsWith("read_") ||
    nameLower.startsWith("is_") ||
    nameLower.startsWith("current_") ||
    nameLower.endsWith("_count") ||
    nameLower === "version" ||
    nameLower === "owner";

  const header = document.createElement("div");
  header.className = "methodHeader";
  const methodNameEl = document.createElement("span");
  methodNameEl.className = "methodName";
  methodNameEl.textContent = methodName;
  const methodTypeEl = document.createElement("span");
  methodTypeEl.className = `methodType ${isRead ? "read" : "write"}`;
  methodTypeEl.textContent = isRead ? "read" : "write";
  header.append(methodNameEl, methodTypeEl);
  card.appendChild(header);

  const inputsContainer = document.createElement("div");
  inputsContainer.className = "methodInputs";
  card.appendChild(inputsContainer);

  const params = [];
  if (methodInfo) {
    const inputInfo = methodInfo.input || methodInfo.inputs || methodInfo.args || methodInfo.parameters;
    if (inputInfo && typeof inputInfo === "object") {
      if (Array.isArray(inputInfo)) {
        inputInfo.forEach((param, i) => {
          const name = param.name || `arg${i}`;
          const type = param.type || param;
          params.push({ name, type, info: inferInputType(type) });
        });
      } else if (inputInfo.type) {
        params.push({ name: "value", type: inputInfo.type || inputInfo, info: inferInputType(inputInfo.type || inputInfo) });
      } else {
        Object.entries(inputInfo).forEach(([name, type]) => {
          params.push({ name, type, info: inferInputType(type) });
        });
      }
    } else if (typeof inputInfo === "string" && inputInfo !== "()" && inputInfo !== "null" && inputInfo !== "unit") {
      params.push({ name: "value", type: inputInfo, info: inferInputType(inputInfo) });
    }
  }

  const inputElements = [];
  params.forEach((param) => {
    const row = document.createElement("div");
    row.className = "inputRow";

    const label = document.createElement("label");
    label.className = "inputLabel";
    label.textContent = `${param.name}:`;

    let input;
    if (param.info.htmlType === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.className = "inputField";
    } else {
      input = document.createElement("input");
      input.type = param.info.htmlType;
      input.className = "inputField";
      input.placeholder = param.info.placeholder;
    }

    const typeHint = document.createElement("span");
    typeHint.className = "inputLabel";
    typeHint.style.minWidth = "auto";
    typeHint.style.fontSize = "10px";
    typeHint.style.opacity = "0.6";
    typeHint.textContent = typeof param.type === "string" ? param.type : JSON.stringify(param.type);

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(typeHint);
    inputsContainer.appendChild(row);
    inputElements.push({ param, input });
  });

  const actions = document.createElement("div");
  actions.className = "methodActions";

  const callBtn = document.createElement("button");
  callBtn.className = `methodBtn ${isRead ? "primary" : ""}`;
  callBtn.textContent = isRead ? "Call (read)" : "Send (write)";

  callBtn.addEventListener("click", async () => {
    callBtn.disabled = true;
    callBtn.textContent = "...";

    try {
      let args = null;
      if (inputElements.length === 0) {
        args = null;
      } else if (inputElements.length === 1) {
        const { param, input } = inputElements[0];
        const val = param.info.htmlType === "checkbox" ? input.checked : input.value;
        args = param.info.parse(val);
      } else {
        args = {};
        for (const { param, input } of inputElements) {
          const val = param.info.htmlType === "checkbox" ? input.checked : input.value;
          args[param.name] = param.info.parse(val);
        }
      }

      schemaLog(`Calling ${methodName}(${args !== null ? JSON.stringify(args) : ""})`);

      if (isRead) {
        const result = await contract.call[methodName](args);
        schemaLog(`✓ ${methodName} => ${JSON.stringify(result)}`);
      } else {
        if (!wallet.state.authorized) {
          await wallet.connect();
        }
        const tx = await contract.write[methodName](args, { amount: "0", deposit: "0" });
        schemaLog(`✓ ${methodName} tx submitted: ${tx.hash}`);
        const receipt = await tx.wait({ timeoutMs: 60_000 });
        if (receipt.ok) {
          schemaLog(`✓ ${methodName} confirmed!`);
        } else {
          schemaLog(`✗ ${methodName} failed: ${receipt.error || "unknown"}`);
        }
      }
    } catch (err) {
      schemaLog(`✗ ${methodName} error: ${err.message || err}`);
    } finally {
      callBtn.disabled = false;
      callBtn.textContent = isRead ? "Call (read)" : "Send (write)";
    }
  });

  actions.appendChild(callBtn);
  card.appendChild(actions);

  return card;
}

function initSchemaExplorer({ schema, version, contractId, contract, wallet }) {
  if (elContractInfo) {
    elContractInfo.replaceChildren();
    appendInfoRow(elContractInfo, "Contract", contractId || "—");
    appendInfoRow(elContractInfo, "Version", version || "unknown");
  }

  if (elRawSchema) {
    elRawSchema.textContent = JSON.stringify(schema, null, 2);
  }

  if (elDynamicMethods) {
    elDynamicMethods.innerHTML = "";

    let methods = {};
    if (schema.methods && typeof schema.methods === "object") {
      methods = schema.methods;
    } else if (schema.functions && Array.isArray(schema.functions)) {
      schema.functions.forEach((fn) => {
        const name = fn.name || fn.fn_name;
        if (name) methods[name] = fn;
      });
    } else if (typeof schema === "object") {
      Object.entries(schema).forEach(([key, value]) => {
        if (typeof value === "object" && !Array.isArray(value)) {
          methods[key] = value;
        }
      });
    }

    if (Object.keys(methods).length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "muted";
      emptyState.textContent = "No methods detected in schema. Check the raw schema below.";
      elDynamicMethods.replaceChildren(emptyState);
      return;
    }

    Object.entries(methods).forEach(([name, info]) => {
      const card = createMethodCard(name, info, contract, wallet);
      elDynamicMethods.appendChild(card);
    });
  }

  schemaLog("Schema explorer initialized");
}

function readConfig() {
  return {
    network: normalizeNetwork(inputNetwork?.value || DEFAULTS.network),
    nodeUrl: inputNode?.value?.trim() || DEFAULTS.nodeUrl,
    driverUrl: inputDriver?.value?.trim() || DEFAULTS.driverUrl,
    contractId: inputContract?.value?.trim() || DEFAULTS.contractId,
  };
}

const cfg = {
  network: normalizeNetwork(getParam("network", DEFAULTS.network)),
  nodeUrl: getParam("nodeUrl", DEFAULTS.nodeUrl),
  driverUrl: getParam("driverUrl", DEFAULTS.driverUrl),
  contractId: getParam("contractId", DEFAULTS.contractId),
};

if (inputNetwork) inputNetwork.value = cfg.network;
if (inputNode) inputNode.value = cfg.nodeUrl;
if (inputDriver) inputDriver.value = cfg.driverUrl;
if (inputContract) inputContract.value = cfg.contractId;

let dusk = createDuskApp({
  nodeUrl: cfg.nodeUrl,
  chain: { chainId: chainIdForNetwork(cfg.network) },
  autoConnect: false,
});

if (connectBtn) connectBtn.wallet = dusk.wallet;

async function loadSchema() {
  const next = readConfig();
  setStatus("Loading schema...", "muted");

  dusk = createDuskApp({
    nodeUrl: next.nodeUrl,
    chain: { chainId: chainIdForNetwork(next.network) },
    autoConnect: false,
  });
  if (connectBtn) connectBtn.wallet = dusk.wallet;

  try {
    const driver = await dusk.driver(next.driverUrl);
    const schema = driver.getSchema();
    const version = driver.getVersion();
    const contract = dusk.contract({
      name: "Schema Target",
      contractId: next.contractId,
      driverUrl: next.driverUrl,
    });

    initSchemaExplorer({
      schema,
      version,
      contractId: next.contractId,
      contract,
      wallet: dusk.wallet,
    });
    setStatus("Schema loaded.", "muted");
  } catch (err) {
    setStatus("Failed to load schema.", "muted");
    if (elRawSchema) elRawSchema.textContent = "";
    if (elDynamicMethods) elDynamicMethods.innerHTML = "";
    schemaLog(`✗ ${err.message || err}`);
  }
}

btnApply?.addEventListener("click", () => {
  loadSchema();
});

loadSchema().catch(() => {});
