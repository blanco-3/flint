const fs = require("fs");
const path = require("path");

class FileRelayStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.state = { requests: {}, safetyFeed: {} };
    this._initialized = false;
  }

  async init() {
    if (this._initialized) {
      return;
    }

    await fs.promises.mkdir(this.dirPath, { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = normalizeStateShape(parsed);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
    this._initialized = true;
  }

  async persist() {
    await fs.promises.mkdir(this.dirPath, { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.state, null, 2) + "\n");
  }

  async createRequest(request) {
    this.state.requests[request.requestId] = request;
    await this.persist();
    return request;
  }

  async updateRequest(requestId, updater) {
    const existing = this.state.requests[requestId];
    if (!existing) {
      return null;
    }

    const next = updater(structuredClone(existing));
    this.state.requests[requestId] = next;
    await this.persist();
    return next;
  }

  async getRequest(requestId) {
    const request = this.state.requests[requestId];
    return request ? structuredClone(request) : null;
  }

  async listRequests({ status } = {}) {
    const requests = Object.values(this.state.requests).map((request) =>
      structuredClone(request)
    );
    if (!status) {
      return requests;
    }
    return requests.filter((request) => request.status === status);
  }

  async upsertSafetyIncident(item) {
    if (!this.state.safetyFeed) {
      this.state.safetyFeed = {};
    }
    this.state.safetyFeed[item.incidentId] = item;
    await this.persist();
    return structuredClone(item);
  }

  async getSafetyIncident(incidentId) {
    if (!this.state.safetyFeed) {
      this.state.safetyFeed = {};
    }
    const item = this.state.safetyFeed[incidentId];
    return item ? structuredClone(item) : null;
  }

  async listSafetyFeed() {
    if (!this.state.safetyFeed) {
      this.state.safetyFeed = {};
    }
    return Object.values(this.state.safetyFeed)
      .map((item) => structuredClone(item))
      .sort((a, b) => a.incidentId.localeCompare(b.incidentId));
  }
}

function normalizeStateShape(parsed) {
  return {
    requests:
      parsed && parsed.requests && typeof parsed.requests === "object" ? parsed.requests : {},
    safetyFeed:
      parsed && parsed.safetyFeed && typeof parsed.safetyFeed === "object"
        ? parsed.safetyFeed
        : {},
  };
}

function defaultStateFile() {
  return path.join(process.cwd(), ".relay-state", "requests.json");
}

module.exports = {
  FileRelayStore,
  defaultStateFile,
};
